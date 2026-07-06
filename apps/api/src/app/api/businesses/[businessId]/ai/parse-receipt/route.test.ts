import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * Tests for POST /ai/parse-receipt (receipt snap-to-expense). Mocks auth
 * and the middleware rate limiter at module level (expenses route-test
 * pattern) and stubs global fetch for the OpenAI call.
 */

// --- auth mock ---
const requireBusinessAccess = vi.fn()
vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// --- middleware mock (rate limiter + body cap) ---
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

// --- OpenAI fetch stub (global fetch) ---
const fetchMock = vi.fn()

function mockOpenAiContent(content: string) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  })
}

// --- Constants ---
const BUSINESS_ID = 'biz-receipt-test-01'
const USER_ID = 'user-receipt-test-01'

const ACCESS = {
  userId: USER_ID,
  businessId: BUSINESS_ID,
  businessName: 'Test Biz',
  businessType: 'retail' as const,
  businessIcon: null,
  businessLocale: 'es-PE',
  businessCurrency: 'PEN',
  role: 'owner' as const,
  plan: 'free' as const,
  planExpiresAt: null as Date | null,
}

// Minimal valid JPEG payload: FF D8 FF magic + padding past the 12-byte
// sniff window.
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00,
])
const VALID_IMAGE = `data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}`

function makeRequest(body: unknown): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:8000/api/businesses/${BUSINESS_ID}/ai/parse-receipt`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(json.length),
        origin: 'http://localhost:8000',
        host: 'localhost:8000',
      },
      body: json,
    },
  )
}

const ROUTE_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID }) }

beforeEach(() => {
  requireBusinessAccess.mockReset().mockResolvedValue({ ...ACCESS })
  applyRateLimit.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('POST /ai/parse-receipt', () => {
  it('parses a receipt and returns the extracted fields (happy path)', async () => {
    mockOpenAiContent(
      JSON.stringify({
        amount: 49.9,
        date: '2026-07-01',
        merchant: 'Ferreteria Lima',
        note: 'Materiales de limpieza',
        categoryName: 'Suministros',
      }),
    )

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ image: VALID_IMAGE }) as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      amount: 49.9,
      date: '2026-07-01',
      merchant: 'Ferreteria Lima',
      note: 'Materiales de limpieza',
      categoryName: 'Suministros',
    })

    // Business locale + currency flow into the system prompt so amounts
    // parse correctly (comma decimals etc).
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(requestBody.model).toBe('gpt-4o-mini')
    expect(requestBody.response_format).toEqual({ type: 'json_object' })
    expect(requestBody.messages[0].content).toContain('es-PE')
    expect(requestBody.messages[0].content).toContain('PEN')
  })

  it('nulls out an invalid or future date instead of failing', async () => {
    mockOpenAiContent(
      JSON.stringify({
        amount: 12,
        date: '2099-01-01',
        merchant: null,
        note: null,
        categoryName: null,
      }),
    )

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ image: VALID_IMAGE }) as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.amount).toBe(12)
    expect(body.data.date).toBeNull()
  })

  it('rejects a missing image with AI_IMAGE_REQUIRED (400)', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest({}) as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.messageCode).toBe('AI_IMAGE_REQUIRED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-image payload before it reaches OpenAI (400)', async () => {
    const notAnImage = `data:image/jpeg;base64,${Buffer.from('<svg>not an image</svg>').toString('base64')}`

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ image: notAnImage }) as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.messageCode).toBe('AI_IMAGE_REQUIRED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns AI_RECEIPT_FAILED when the model JSON is malformed', async () => {
    mockOpenAiContent('this is not json at all')

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ image: VALID_IMAGE }) as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.messageCode).toBe('AI_RECEIPT_FAILED')
  })

  it('returns AI_RECEIPT_FAILED when the model omits a usable amount', async () => {
    mockOpenAiContent(
      JSON.stringify({ amount: null, date: null, merchant: null, note: null, categoryName: null }),
    )

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ image: VALID_IMAGE }) as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.messageCode).toBe('AI_RECEIPT_FAILED')
  })

  it('uses the free daily bucket (ai-daily:) for free businesses', async () => {
    mockOpenAiContent(JSON.stringify({ amount: 5, date: null, merchant: null, note: null, categoryName: null }))

    const { POST } = await import('./route')
    await POST(makeRequest({ image: VALID_IMAGE }) as Parameters<typeof POST>[0], ROUTE_PARAMS)

    const keys = applyRateLimit.mock.calls.map((c) => c[0])
    expect(keys).toContain(`ai:${USER_ID}`)
    expect(keys).toContain(`ai-daily:${USER_ID}`)
    expect(keys.some((k) => String(k).startsWith('ai-global:'))).toBe(true)
    expect(keys).not.toContain(`ai-daily-pro:${USER_ID}`)
  })

  it('uses the pro daily bucket (ai-daily-pro:) for active Pro businesses', async () => {
    requireBusinessAccess.mockResolvedValue({
      ...ACCESS,
      plan: 'pro' as const,
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    mockOpenAiContent(JSON.stringify({ amount: 5, date: null, merchant: null, note: null, categoryName: null }))

    const { POST } = await import('./route')
    await POST(makeRequest({ image: VALID_IMAGE }) as Parameters<typeof POST>[0], ROUTE_PARAMS)

    const keys = applyRateLimit.mock.calls.map((c) => c[0])
    expect(keys).toContain(`ai-daily-pro:${USER_ID}`)
    expect(keys).not.toContain(`ai-daily:${USER_ID}`)

    // The pro key must ride the pro config (400/day), not the free one.
    const proCall = applyRateLimit.mock.calls.find(
      (c) => c[0] === `ai-daily-pro:${USER_ID}`,
    )
    expect((proCall?.[1] as { limit: number }).limit).toBe(400)
  })

  it('falls back to the free bucket when the pro plan is expired', async () => {
    requireBusinessAccess.mockResolvedValue({
      ...ACCESS,
      plan: 'pro' as const,
      planExpiresAt: new Date(Date.now() - 1000),
    })
    mockOpenAiContent(JSON.stringify({ amount: 5, date: null, merchant: null, note: null, categoryName: null }))

    const { POST } = await import('./route')
    await POST(makeRequest({ image: VALID_IMAGE }) as Parameters<typeof POST>[0], ROUTE_PARAMS)

    const keys = applyRateLimit.mock.calls.map((c) => c[0])
    expect(keys).toContain(`ai-daily:${USER_ID}`)
    expect(keys).not.toContain(`ai-daily-pro:${USER_ID}`)
  })
})
