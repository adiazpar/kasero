import { describe, it, expect, beforeEach, vi } from 'vitest'

const STORAGE_KEY = 'kasero.device-id'

describe('getDeviceId', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
      clear: () => { store = {} },
    })
    vi.resetModules()
  })

  it('returns existing value when present', async () => {
    store[STORAGE_KEY] = 'existing-id-abc'
    const { getDeviceId } = await import('./device-id')
    expect(getDeviceId()).toBe('existing-id-abc')
  })

  it('generates and persists a new id when missing', async () => {
    const { getDeviceId } = await import('./device-id')
    const id = getDeviceId()
    expect(id).toBeTruthy()
    expect(id.length).toBeGreaterThan(10)
    expect(store[STORAGE_KEY]).toBe(id)
  })

  it('is idempotent across multiple calls', async () => {
    const { getDeviceId } = await import('./device-id')
    const id1 = getDeviceId()
    const id2 = getDeviceId()
    const id3 = getDeviceId()
    expect(id1).toBe(id2)
    expect(id2).toBe(id3)
  })

  it("returns 'ssr' when window is undefined", async () => {
    const originalWindow = globalThis.window
    // @ts-expect-error intentionally removing window for SSR test
    delete globalThis.window
    try {
      const { getDeviceId } = await import('./device-id')
      expect(getDeviceId()).toBe('ssr')
    } finally {
      globalThis.window = originalWindow
    }
  })
})
