import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import React from 'react'
import { IntlProvider } from 'react-intl'

// ============================================================
// MOCKS — must be hoisted before the module under test loads
// ============================================================

const mockPush = vi.fn()
vi.mock('@/lib/next-navigation-shim', () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
}))

const mockPresentToast = vi.fn()
vi.mock('@ionic/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ionic/react')>()
  return {
    ...actual,
    useIonToast: () => [mockPresentToast, vi.fn()],
  }
})

const mockIsAuthenticated = vi.fn<() => boolean>(() => false)
const mockUser = vi.fn<() => { id: string } | null>(() => null)
const mockLogout = vi.fn()
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated(),
    user: mockUser(),
    logout: mockLogout,
  }),
}))

const DEVICE_ID = 'test-device-id'
vi.mock('@/lib/realtime/device-id', () => ({
  getDeviceId: () => DEVICE_ID,
}))

const mockDispatchRealtimeEvent = vi.fn()
vi.mock('@/lib/realtime/handlers', () => ({
  dispatchRealtimeEvent: (...args: unknown[]) => mockDispatchRealtimeEvent(...args),
}))

const mockCallRefetch = vi.fn()
vi.mock('@/lib/realtime/refetch-registry', () => ({
  callRefetch: (...args: unknown[]) => mockCallRefetch(...args),
  callAllRefetches: vi.fn(),
}))

// ============================================================
// MOCK EventSource
// ============================================================

type ESListener = (event: Event) => void

class MockEventSource {
  static instances: MockEventSource[] = []

  url: string
  readyState: number = 0 // CONNECTING
  onmessage: ((ev: MessageEvent) => void) | null = null
  listeners: Map<string, ESListener[]> = new Map()
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: ESListener) {
    const arr = this.listeners.get(type) ?? []
    arr.push(fn)
    this.listeners.set(type, arr)
  }

  removeEventListener(type: string, fn: ESListener) {
    const arr = this.listeners.get(type) ?? []
    this.listeners.set(type, arr.filter((f) => f !== fn))
  }

  close() {
    this.closed = true
    this.readyState = 2 // CLOSED
  }

  // Test helpers to simulate browser-dispatched events.
  simulateOpen() {
    this.readyState = 1 // OPEN
    const fns = this.listeners.get('open') ?? []
    for (const fn of fns) fn(new Event('open'))
  }

  simulateMessage(data: unknown) {
    const ev = new MessageEvent('message', { data: JSON.stringify(data) })
    if (this.onmessage) this.onmessage(ev)
    const fns = this.listeners.get('message') ?? []
    for (const fn of fns) fn(ev)
  }

  simulateError() {
    const fns = this.listeners.get('error') ?? []
    for (const fn of fns) fn(new Event('error'))
  }

  static reset() {
    MockEventSource.instances = []
  }

  static latest(): MockEventSource {
    const inst = MockEventSource.instances[MockEventSource.instances.length - 1]
    if (!inst) throw new Error('No MockEventSource instances')
    return inst
  }
}

// Install mock before tests run.
vi.stubGlobal('EventSource', MockEventSource)

// ============================================================
// HELPERS
// ============================================================

function Wrapper({ children }: { children: ReactNode }) {
  return (
    // messages omitted intentionally — tests don't assert on translated strings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <IntlProvider locale="en" defaultLocale="en" messages={{} as any}>
      {children}
    </IntlProvider>
  )
}

async function importProvider() {
  return import('./realtime-context')
}

// ============================================================
// TESTS
// ============================================================

describe('RealtimeProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.reset()
    mockDispatchRealtimeEvent.mockReset()
    mockPush.mockReset()
    mockPresentToast.mockReset()
    mockLogout.mockReset()
    mockCallRefetch.mockReset()
    // Default: not authenticated.
    mockIsAuthenticated.mockReturnValue(false)
    mockUser.mockReturnValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ----------------------------------------------------------
  // 1. Opens EventSource when authenticated
  // ----------------------------------------------------------
  it('opens an EventSource when isAuthenticated is true', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider } = await importProvider()

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    expect(MockEventSource.instances.length).toBe(1)
    expect(MockEventSource.latest().url).toContain('/api/realtime')
    expect(MockEventSource.latest().url).toContain(`deviceId=${DEVICE_ID}`)
  })

  // ----------------------------------------------------------
  // 2. Does NOT open EventSource when not authenticated
  // ----------------------------------------------------------
  it('does not open an EventSource when not authenticated', async () => {
    const { RealtimeProvider } = await importProvider()

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    expect(MockEventSource.instances.length).toBe(0)
  })

  // ----------------------------------------------------------
  // 3. Closes on logout (isAuthenticated → false)
  // ----------------------------------------------------------
  it('closes the EventSource when isAuthenticated becomes false', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider } = await importProvider()

    const { rerender } = await act(async () =>
      render(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      ),
    )

    const es = MockEventSource.latest()
    expect(es.closed).toBe(false)

    // Simulate logout.
    mockIsAuthenticated.mockReturnValue(false)
    mockUser.mockReturnValue(null)

    await act(async () => {
      rerender(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    expect(es.closed).toBe(true)
  })

  // ----------------------------------------------------------
  // 4. Dispatches received messages through dispatchRealtimeEvent
  // ----------------------------------------------------------
  it('calls dispatchRealtimeEvent for each message event', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider } = await importProvider()

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    const es = MockEventSource.latest()
    const payload = { type: 'business.updated', fields: ['name'] }

    await act(async () => {
      es.simulateMessage(payload)
    })

    expect(mockDispatchRealtimeEvent).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ ownDeviceId: DEVICE_ID }),
    )
  })

  // ----------------------------------------------------------
  // 5. Closes and reopens on business switch (with 250ms debounce)
  // ----------------------------------------------------------
  it('debounces business-id switch and reopens EventSource', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider, useRealtime } = await importProvider()

    let setActiveBusinessId!: (id: string | null) => void

    function Consumer() {
      const ctx = useRealtime()
      setActiveBusinessId = ctx.setActiveBusinessId
      return null
    }

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <Consumer />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    expect(MockEventSource.instances.length).toBe(1)
    const firstEs = MockEventSource.latest()

    // Call setActiveBusinessId — should be debounced for 250ms.
    await act(async () => {
      setActiveBusinessId('biz-1')
    })

    // Before debounce fires — still 1 instance, first not closed yet.
    expect(MockEventSource.instances.length).toBe(1)

    // Fast-forward 250ms to trigger debounce.
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    // Now the switch should have happened.
    expect(firstEs.closed).toBe(true)
    expect(MockEventSource.instances.length).toBe(2)
    expect(MockEventSource.latest().url).toContain('businessId=biz-1')
    expect(MockEventSource.latest().url).toContain(`deviceId=${DEVICE_ID}`)
  })

  it('debounces rapid business-id switches to only the last one', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider, useRealtime } = await importProvider()

    let setActiveBusinessId!: (id: string | null) => void

    function Consumer() {
      const ctx = useRealtime()
      setActiveBusinessId = ctx.setActiveBusinessId
      return null
    }

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <Consumer />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    // Rapid switches within 250ms window — only last should take effect.
    await act(async () => {
      setActiveBusinessId('biz-A')
      vi.advanceTimersByTime(100)
      setActiveBusinessId('biz-B')
      vi.advanceTimersByTime(100)
      setActiveBusinessId('biz-C')
    })

    expect(MockEventSource.instances.length).toBe(1) // debounce still pending

    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    // Only one new connection, with the last business id.
    expect(MockEventSource.instances.length).toBe(2)
    expect(MockEventSource.latest().url).toContain('businessId=biz-C')
  })

  // ----------------------------------------------------------
  // 6. Watchdog fires after 45s of silence → close + reopen
  // ----------------------------------------------------------
  it('watchdog closes and reopens EventSource after 45s of silence', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider } = await importProvider()

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    const firstEs = MockEventSource.latest()
    expect(MockEventSource.instances.length).toBe(1)

    // Simulate an open to start the watchdog timer.
    await act(async () => {
      firstEs.simulateOpen()
    })

    // Advance 44 seconds — watchdog should NOT have fired yet.
    await act(async () => {
      vi.advanceTimersByTime(44_000)
    })
    expect(firstEs.closed).toBe(false)
    expect(MockEventSource.instances.length).toBe(1)

    // Advance 1 more second — 45s total triggers the watchdog.
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })

    expect(firstEs.closed).toBe(true)
    expect(MockEventSource.instances.length).toBe(2)
  })

  it('watchdog resets on message receipt', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider } = await importProvider()

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    const es = MockEventSource.latest()

    await act(async () => {
      es.simulateOpen()
    })

    // After 40s, send a message — this resets the 45s timer.
    await act(async () => {
      vi.advanceTimersByTime(40_000)
      es.simulateMessage({ type: 'business.updated', fields: ['name'] })
    })

    // 40s more (80s total, but timer was reset at 40s) — still no reconnect.
    await act(async () => {
      vi.advanceTimersByTime(40_000)
    })
    expect(es.closed).toBe(false)

    // Now go 5s more to cross 45s from the last message — watchdog fires.
    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(es.closed).toBe(true)
  })

  // ----------------------------------------------------------
  // 7. 3 consecutive errors without open → routes to login
  // ----------------------------------------------------------
  it('calls logout after 3 consecutive errors without open', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider } = await importProvider()

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    const es = MockEventSource.latest()

    await act(async () => {
      es.simulateError()
      es.simulateError()
    })

    // Only 2 errors — should NOT have triggered logout yet.
    expect(mockLogout).not.toHaveBeenCalled()

    await act(async () => {
      es.simulateError()
    })

    // After 3rd error — logout should have been called.
    expect(mockLogout).toHaveBeenCalled()
  })

  it('resets the error counter on open event', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockUser.mockReturnValue({ id: 'user-1' })

    const { RealtimeProvider } = await importProvider()

    await act(async () => {
      render(
        <Wrapper>
          <RealtimeProvider>
            <div />
          </RealtimeProvider>
        </Wrapper>,
      )
    })

    const es = MockEventSource.latest()

    await act(async () => {
      es.simulateError()
      es.simulateError()
      es.simulateOpen() // Resets counter to 0.
      es.simulateError()
      es.simulateError()
    })

    // Only 2 errors since last open — should not trigger logout.
    expect(mockLogout).not.toHaveBeenCalled()
  })
})
