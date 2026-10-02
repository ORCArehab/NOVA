import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAnalyzerAvailable } from './apiClient'

afterEach(() => {
  vi.unstubAllGlobals()
})

function respond(status: number, body: string) {
  const fetch = vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('fetchAnalyzerAvailable', () => {
  it('is true only for a clear yes from /api/capabilities', async () => {
    const fetch = respond(200, JSON.stringify({ analyzer: true }))
    expect(await fetchAnalyzerAvailable()).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/capabilities', { cache: 'no-store' })
  })

  it('fails closed on anything else', async () => {
    for (const [status, body] of [
      [200, JSON.stringify({ analyzer: false })],
      [200, JSON.stringify({ analyzer: 'yes' })],
      [200, JSON.stringify({})],
      [200, 'not json'],
      [401, JSON.stringify({ error: 'expired' })],
      [403, JSON.stringify({ error: 'no access' })],
      [500, ''],
      [503, JSON.stringify({ analyzer: true })],
    ] as const) {
      respond(status, body)
      expect(await fetchAnalyzerAvailable(), `${status} ${body}`).toBe(false)
    }
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))))
    expect(await fetchAnalyzerAvailable()).toBe(false)
  })
})
