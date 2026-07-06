import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * Tests for POST /pulse (Kasero Pulse digest). Mocks auth, the middleware
 * rate limiter, the free-sample limiter, and the data-gathering module;
 * stubs global fetch for the OpenAI call (expenses route-test pattern).
 */

// --- auth mock ---
const requireBusinessAccess = vi.fn()
vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// --- middleware mock (standard AI rate-limit layers) ---
const applyRateLimit = vi.fn(
  async (_id: string, _config: unknown): Promise<NextResponse | null> => null,
)
vi.mock('@/lib/api-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-middleware')>(
    '@/lib/api-middleware',
  )
  return {
    ...actual,
    enforceMaxContentLength: vi.fn(() => null),
    applyRateLimit,
  }
})

// --- free-sample limiter mock (checkRateLimit is called directly by the
// route because the limited outcome is a 403 paywall, not a 429) ---
const checkRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (orig) => {
  const real = await orig<typeof import('@/lib/rate-limit')>()
  return { ...real, checkRateLimit }
})

// --- data-gathering mock (the queries themselves are covered by the
// sales aggregate / expenses summary suites) ---
const gatherPulseData = vi.fn()
const fetchUserLanguage = vi.fn()
vi.mock('./data', () => ({
  gatherPulseData,
  fetchUserLanguage,
}))

// --- OpenAI fetch stub ---
const fetchMock = vi.fn()

const VALID_DIGEST = {
  headline: 'A steady week for Test Biz',
  sections: [
    { title: 'Sales', body: 'Revenue held at S/ 1,200.00 this week.' },
    { title: 'Expenses', body: 'Spending stayed under control.' },
  ],
  watchouts: ['Two products are low on stock.'],
}

function openAiResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }
}

// --- Constants ---
const BUSINESS_ID = 'biz-pulse-test-01'
const USER_ID = 'user-pulse-test-01'

const ACCESS = {
  userId: USER_ID,
  businessId: BUSINESS_ID,
  businessName: 'Test Biz',
  businessType: 'food' as const,
  businessIcon: null,
  businessLocale: 'es-PE',
  businessCurrency: 'PEN',
  role: 'employee' as const, // any member role may generate
  plan: 'free' as const,
  planExpiresAt: null as Date | null,
}

const SUMMARY = {
  business: { name: 'Test Biz' },
  generatedAtUtc: '2026-07-06T00:00:00.000Z',
  today: { revenue: 'S/ 150.00', salesCount: 4, avgTicket: 'S/ 37.50', vsYesterdayPct: 10 },
  last7Days: { total: 'S/ 1,200.00', previousWeekTotal: 'S/ 1,000.00', dailyRevenue: [], paymentSplit: [] },
  thisMonth: { month: '2026-07', income: 'S/ 1,500.00', expenses: 'S/ 400.00', net: 'S/ 1,100.00' },
  topProductsLast30Days: [],
  lowStockProducts: [],
}

function makeRequest(): Request {
  const json = JSON.stringify({})
  return new Request(`http://localhost:8000/api/businesses/${BUSINESS_ID}/pulse`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(json.length),
      origin: 'http://localhost:8000',
      host: 'localhost:8000',
    },
    body: json,
  })
}

const ROUTE_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID }) }

beforeEach(() => {
  requireBusinessAccess.mockReset().mockResolvedValue({ ...ACCESS })
  applyRateLimit.mockReset().mockResolvedValue(null)
  checkRateLimit.mockReset().mockResolvedValue({ success: true, remaining: 0, resetAt: Date.now() + 1000 })
  gatherPulseData.mockReset().mockResolvedValue(SUMMARY)
  fetchUserLanguage.mockReset().mockResolvedValue('es')
  fetchMock.mockReset().mockResolvedValue(openAiResponse(JSON.stringify(VALID_DIGEST)))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('POST /pulse', () => {
  it('generates a digest for a free business with its monthly sample (happy path)', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.headline).toBe(VALID_DIGEST.headline)
    expect(body.data.sections).toHaveLength(2)
    expect(body.data.watchouts).toEqual(VALID_DIGEST.watchouts)
    expect(typeof body.data.generatedAt).toBe('string')

    // Free gate consumed under the month-stamped business key.
    const monthStamp = new Date().toISOString().slice(0, 7)
    expect(checkRateLimit).toHaveBeenCalledWith(
      `pulse-free:${BUSINESS_ID}:${monthStamp}`,
      expect.objectContaining({ limit: 1, failClosed: true }),
    )

    // Digest language = the USER's UI language, not the business locale.
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(requestBody.messages[0].content).toContain('Spanish')
    expect(requestBody.response_format).toEqual({ type: 'json_object' })
  })

  it('returns 403 PULSE_FREE_LIMIT_REACHED when the free sample is spent', async () => {
    // Key the exhaustion on the pulse-free prefix — withBusinessAuth's
    // own mutate: limit also flows through this mock and must pass.
    checkRateLimit.mockImplementation(async (id: string) =>
      id.startsWith('pulse-free:')
        ? { success: false, remaining: 0, resetAt: Date.now() + 1000 }
        : { success: true, remaining: 1, resetAt: Date.now() + 1000 },
    )

    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.messageCode).toBe('PULSE_FREE_LIMIT_REACHED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bypasses the free-sample gate for active Pro businesses and uses the pro daily bucket', async () => {
    requireBusinessAccess.mockResolvedValue({
      ...ACCESS,
      plan: 'pro' as const,
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    // Even an exhausted free counter must not matter for Pro.
    checkRateLimit.mockImplementation(async (id: string) =>
      id.startsWith('pulse-free:')
        ? { success: false, remaining: 0, resetAt: Date.now() + 1000 }
        : { success: true, remaining: 1, resetAt: Date.now() + 1000 },
    )

    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)

    expect(res.status).toBe(200)
    // The pulse-free gate is never consulted for Pro (the only other
    // checkRateLimit traffic is withBusinessAuth's own mutate: limit).
    expect(
      checkRateLimit.mock.calls.some((c) => String(c[0]).startsWith('pulse-free:')),
    ).toBe(false)

    const keys = applyRateLimit.mock.calls.map((c) => c[0])
    expect(keys).toContain(`ai:${USER_ID}`)
    expect(keys).toContain(`ai-daily-pro:${USER_ID}`)
    expect(keys).not.toContain(`ai-daily:${USER_ID}`)
    expect(keys.some((k) => String(k).startsWith('ai-global:'))).toBe(true)
  })

  it('retries once on malformed model JSON, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(openAiResponse('not json'))
      .mockResolvedValueOnce(openAiResponse(JSON.stringify(VALID_DIGEST)))

    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.headline).toBe(VALID_DIGEST.headline)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns AI_PULSE_FAILED after two malformed model responses', async () => {
    fetchMock.mockResolvedValue(openAiResponse('{"headline": "only a headline"}'))

    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.messageCode).toBe('AI_PULSE_FAILED')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
