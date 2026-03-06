import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
/**
 * 口型同步统一入口（FAL / Vidu）
 */

import { submitFalTask } from '@/lib/async-submit'
import { getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { normalizeToOriginalMediaUrl } from '@/lib/media/outbound-image'

function assertFalFetchableUrl(field: 'video_url' | 'audio_url', value: string): void {
  if (value.startsWith('data:')) {
    throw new Error(`${field} 不能使用 data URL，请改用可访问的 HTTP(S) 文件地址`)
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${field} 必须是完整的 HTTP(S) URL，当前值无效`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${field} 必须使用 HTTP(S) 协议，当前协议: ${parsed.protocol}`)
  }

  const blockedHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
  if (blockedHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error(`${field} 指向本机地址(${parsed.hostname})，FAL 无法从公网访问该文件`)
  }
}

/**
 * 口型同步结果
 */
export interface LipSyncResult {
  videoUrl?: string
  requestId: string
  externalId?: string
  async?: boolean
}

/**
 * 口型同步参数
 */
export interface LipSyncParams {
  videoUrl: string    // 视频 URL (支持 .mp4/.mov, ≤100MB, 2-10s, 720p/1080p, width/height 720-1920px)
  audioUrl: string    // 音频 URL (最小2s, 最大60s, 最大5MB)
}

interface ViduLipSyncSubmitResponse {
  task_id?: string
  state?: string
  err_code?: string
}

/**
 * 提交口型同步任务（异步模式）
 * 
 * @param params 口型同步参数
 * @param userId 用户ID，用于获取API Key
 * @returns 任务ID，由前端轮询或Cron处理
 */
export async function generateLipSync(
  params: LipSyncParams,
  userId: string,
  modelKey?: string,
): Promise<LipSyncResult> {
  _ulogInfo('[LipSync Async] 开始提交口型同步任务')

  try {
    const selection = await resolveModelSelectionOrSingle(userId, modelKey, 'lipsync')
    const providerKey = getProviderKey(selection.provider)

    if (providerKey === 'fal') {
      const endpoint = selection.modelId
      if (!endpoint) {
        throw new Error(`LIPSYNC_ENDPOINT_MISSING: ${selection.modelKey}`)
      }

      const videoInputUrl = await normalizeToOriginalMediaUrl(params.videoUrl)
      const audioInputUrl = await normalizeToOriginalMediaUrl(params.audioUrl)
      assertFalFetchableUrl('video_url', videoInputUrl)
      assertFalFetchableUrl('audio_url', audioInputUrl)
      _ulogInfo('[LipSync Async] FAL 入参已归一化为可访问 URL')

      const input = {
        video_url: videoInputUrl,
        audio_url: audioInputUrl,
      }

      const { apiKey } = await getProviderConfig(userId, selection.provider)
      const requestId = await submitFalTask(endpoint, input, apiKey)
      _ulogInfo(`[LipSync Async] FAL 任务已提交: ${requestId}`)

      return {
        requestId,
        externalId: `FAL:VIDEO:${endpoint}:${requestId}`,
        async: true,
      }
    }

    if (providerKey === 'vidu') {
      const { apiKey } = await getProviderConfig(userId, selection.provider)
      const response = await fetch('https://api.vidu.cn/ent/v2/lip-sync', {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_url: params.videoUrl,
          audio_url: params.audioUrl,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`VIDU_LIPSYNC_SUBMIT_FAILED: ${response.status} ${errorText}`)
      }

      const data = (await response.json()) as ViduLipSyncSubmitResponse
      const taskId = typeof data.task_id === 'string' ? data.task_id.trim() : ''
      if (!taskId) {
        throw new Error('VIDU_LIPSYNC_TASK_ID_MISSING')
      }
      if (data.state === 'failed') {
        throw new Error(`VIDU_LIPSYNC_SUBMIT_FAILED: ${data.err_code || 'unknown'}`)
      }

      _ulogInfo(`[LipSync Async] Vidu 任务已提交: ${taskId}`)
      return {
        requestId: taskId,
        externalId: `VIDU:VIDEO:${taskId}`,
        async: true,
      }
    }

    throw new Error(`LIPSYNC_PROVIDER_UNSUPPORTED: ${selection.provider}`)

  } catch (error: unknown) {
    const errorObject =
      typeof error === 'object' && error !== null
        ? (error as { message?: unknown; body?: unknown })
        : null
    _ulogError('[LipSync Async] 错误:', error)
    let errorDetails =
      typeof errorObject?.message === 'string' ? errorObject.message : '未知错误'
    const body = (errorObject?.body && typeof errorObject.body === 'object')
      ? (errorObject.body as { detail?: unknown })
      : null
    if (body) {
      _ulogError('[LipSync Async] 错误详情:', JSON.stringify(body, null, 2))
      if (body.detail) {
        errorDetails = typeof body.detail === 'string'
          ? body.detail
          : JSON.stringify(body.detail)
      }
    }
    throw new Error(`口型同步任务提交失败: ${errorDetails}`)
  }
}
