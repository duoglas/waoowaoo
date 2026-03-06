import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryFalStatus } from '@/lib/async-submit'

describe('queryFalStatus result URL resolution', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
  })

  it('prioritizes response_url and falls back to canonical URL when needed', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETED',
          response_url: 'https://queue.fal.run/fal-ai/kling-video/lipsync/audio-to-video/requests/req_123',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 405,
        text: async () => '405: Method Not Allowed',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          video: { url: 'https://cdn.example.com/lipsync.mp4' },
        }),
      })

    const result = await queryFalStatus(
      'fal-ai/kling-video/lipsync/audio-to-video',
      'req_123',
      'fal-key',
    )

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://queue.fal.run/fal-ai/kling-video/requests/req_123/status?logs=0',
      expect.objectContaining({
        method: 'GET',
      }),
    )
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://queue.fal.run/fal-ai/kling-video/lipsync/audio-to-video/requests/req_123',
      expect.objectContaining({
        method: 'GET',
      }),
    )
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      'https://queue.fal.run/fal-ai/kling-video/requests/req_123',
      expect.objectContaining({
        method: 'GET',
      }),
    )
    expect(result).toEqual({
      status: 'COMPLETED',
      completed: true,
      failed: false,
      resultUrl: 'https://cdn.example.com/lipsync.mp4',
    })
  })

  it('uses response_url when endpoint has no path segment', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETED',
          response_url: 'https://queue.fal.run/fal-ai/kling-video/requests/req_456',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          video: { url: 'https://cdn.example.com/base-endpoint.mp4' },
        }),
      })

    const result = await queryFalStatus('fal-ai/kling-video', 'req_456', 'fal-key')

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://queue.fal.run/fal-ai/kling-video/requests/req_456',
      expect.objectContaining({
        method: 'GET',
      }),
    )
    expect(result).toEqual({
      status: 'COMPLETED',
      completed: true,
      failed: false,
      resultUrl: 'https://cdn.example.com/base-endpoint.mp4',
    })
  })

  it('marks task failed when completed result fetch keeps failing', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETED',
          response_url: 'https://queue.fal.run/fal-ai/kling-video/requests/req_789',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 405,
        text: async () => '405: Method Not Allowed',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 405,
        text: async () => '405: Method Not Allowed',
      })

    const result = await queryFalStatus(
      'fal-ai/kling-video/lipsync/audio-to-video',
      'req_789',
      'fal-key',
    )

    expect(result.status).toBe('COMPLETED')
    expect(result.completed).toBe(true)
    expect(result.failed).toBe(true)
    expect(result.error).toContain('405')
  })
})
