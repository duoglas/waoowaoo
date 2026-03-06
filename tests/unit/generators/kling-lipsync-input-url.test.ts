import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelectionOrSingle: vi.fn(async () => ({
    provider: 'fal',
    modelId: 'fal-ai/kling-video/lipsync/audio-to-video',
    modelKey: 'kling-lipsync',
  })),
  getProviderKey: vi.fn(() => 'fal'),
  getProviderConfig: vi.fn(async () => ({ apiKey: 'fal-key' })),
}))

const asyncSubmitMock = vi.hoisted(() => ({
  submitFalTask: vi.fn(async () => 'req_lipsync_1'),
}))

const outboundImageMock = vi.hoisted(() => ({
  normalizeToOriginalMediaUrl: vi.fn(async (value: string) => value),
}))

vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/async-submit', () => asyncSubmitMock)
vi.mock('@/lib/media/outbound-image', () => outboundImageMock)

import { generateLipSync } from '@/lib/kling'

describe('generateLipSync FAL input URL normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.resolveModelSelectionOrSingle.mockResolvedValue({
      provider: 'fal',
      modelId: 'fal-ai/kling-video/lipsync/audio-to-video',
      modelKey: 'kling-lipsync',
    })
    apiConfigMock.getProviderKey.mockReturnValue('fal')
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'fal-key' })
    asyncSubmitMock.submitFalTask.mockResolvedValue('req_lipsync_1')
    outboundImageMock.normalizeToOriginalMediaUrl.mockImplementation(async (value: string) => value)
  })

  it('submits normalized HTTP URLs to FAL instead of data URLs', async () => {
    outboundImageMock.normalizeToOriginalMediaUrl
      .mockResolvedValueOnce('https://cdn.example.com/panel.mp4')
      .mockResolvedValueOnce('https://cdn.example.com/voice.wav')

    const result = await generateLipSync(
      {
        videoUrl: 'video/panel-key.mp4',
        audioUrl: 'voice/audio-key.wav',
      },
      'user-1',
      'kling-lipsync',
    )

    expect(asyncSubmitMock.submitFalTask).toHaveBeenCalledWith(
      'fal-ai/kling-video/lipsync/audio-to-video',
      {
        video_url: 'https://cdn.example.com/panel.mp4',
        audio_url: 'https://cdn.example.com/voice.wav',
      },
      'fal-key',
    )
    expect(result).toEqual({
      requestId: 'req_lipsync_1',
      externalId: 'FAL:VIDEO:fal-ai/kling-video/lipsync/audio-to-video:req_lipsync_1',
      async: true,
    })
  })

  it('fails fast when normalized input is a data URL', async () => {
    outboundImageMock.normalizeToOriginalMediaUrl
      .mockResolvedValueOnce('data:video/mp4;base64,AAAA')
      .mockResolvedValueOnce('https://cdn.example.com/voice.wav')

    await expect(
      generateLipSync(
        {
          videoUrl: 'video/panel-key.mp4',
          audioUrl: 'voice/audio-key.wav',
        },
        'user-1',
      ),
    ).rejects.toThrow('video_url 不能使用 data URL')

    expect(asyncSubmitMock.submitFalTask).not.toHaveBeenCalled()
  })

  it('fails fast when normalized input points to localhost', async () => {
    outboundImageMock.normalizeToOriginalMediaUrl
      .mockResolvedValueOnce('http://localhost:3000/api/files/video.mp4')
      .mockResolvedValueOnce('https://cdn.example.com/voice.wav')

    await expect(
      generateLipSync(
        {
          videoUrl: 'video/panel-key.mp4',
          audioUrl: 'voice/audio-key.wav',
        },
        'user-1',
      ),
    ).rejects.toThrow('video_url 指向本机地址')

    expect(asyncSubmitMock.submitFalTask).not.toHaveBeenCalled()
  })
})
