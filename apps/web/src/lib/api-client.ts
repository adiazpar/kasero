/**
 * Centralized API client for frontend fetch calls.
 *
 * Provides consistent error handling and response parsing across hooks.
 */

import {
  hasMessageEnvelope,
  type ApiMessageCode,
  type ApiMessageEnvelope,
} from '@kasero/shared/api-messages'
import { getDeviceId } from './realtime/device-id'

export interface ApiResponse<T = unknown> {
  success?: boolean
  data?: T
  /** Legacy error string field. Deprecated in favor of messageCode. */
  error?: string
  /** Server-emitted message code for i18n translation. */
  messageCode?: ApiMessageCode
  /** Variables for ICU interpolation on the client. */
  messageVars?: Record<string, string | number>
  [key: string]: unknown
}

/**
 * Custom error class for API errors.
 *
 * Prefers the structured messageCode/messageVars envelope when present;
 * falls back to the legacy `error` string for routes that haven't been
 * migrated yet. Consumers should branch on `err.messageCode` first and
 * only read `err.message` for non-migrated paths.
 */
export class ApiError extends Error {
  public readonly statusCode: number
  public readonly data: ApiResponse
  public readonly messageCode: ApiMessageCode | null
  public readonly messageVars: Record<string, string | number> | undefined

  constructor(statusCode: number, data: ApiResponse, message?: string) {
    super(message || data.error || 'API request failed')
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.data = data
    this.messageCode = hasMessageEnvelope(data) ? data.messageCode : null
    this.messageVars = hasMessageEnvelope(data) ? data.messageVars : undefined
  }

  /**
   * Returns the structured envelope for consumers that use useApiMessage().
   * Returns null for legacy responses that only carry an `error` string.
   */
  get envelope(): ApiMessageEnvelope | null {
    if (!this.messageCode) return null
    return { messageCode: this.messageCode, messageVars: this.messageVars }
  }
}

/**
 * Make an API request with standardized error handling.
 *
 * Throws ApiError if the response is not ok or if success is explicitly false.
 *
 * @example
 * ```typescript
 * try {
 *   const data = await apiRequest<ProductsResponse>('/api/products')
 *   setProducts(data.products)
 * } catch (error) {
 *   if (error instanceof ApiError) {
 *     // Preferred: structured envelope
 *     if (error.envelope) {
 *       setError(translateApiMessage(error.envelope))
 *     } else {
 *       // Legacy fallback
 *       setError(error.message)
 *     }
 *   }
 * }
 * ```
 */
export async function apiRequest<T extends ApiResponse>(
  url: string,
  options?: RequestInit
): Promise<T> {
  // Inject X-Device-Id on every outbound request. The realtime publisher
  // echoes this id back via originDeviceId so the publishing client can
  // suppress its own event (echo suppression).
  const headers = new Headers(options?.headers)
  if (!headers.has('x-device-id')) {
    try {
      headers.set('x-device-id', getDeviceId())
    } catch {
      // localStorage unavailable; omit the header rather than throw.
    }
  }
  const augmentedOptions: RequestInit = { ...options, headers }

  let response: Response
  try {
    response = await fetch(url, augmentedOptions)
  } catch (err) {
    // Network-layer failure (offline, DNS error, request blocked). The
    // browser-specific TypeError messages we recognise: Chrome ("Failed
    // to fetch"), Firefox ("NetworkError when attempting to fetch
    // resource."), Safari ("Load failed"). Anything else (e.g. AbortError
    // from a manual signal) we rethrow unchanged so callers can handle it
    // as before.
    if (err instanceof TypeError && /Failed to fetch|NetworkError|Load failed/i.test(err.message)) {
      throw new ApiError(0, { success: false, messageCode: 'OFFLINE_MUTATION_BLOCKED' })
    }
    throw err
  }

  const text = await response.text()
  if (!text) {
    throw new ApiError(response.status, { success: false, error: 'EMPTY_RESPONSE' } as T, 'EMPTY_RESPONSE')
  }

  let data: T
  try {
    data = JSON.parse(text) as T
  } catch {
    throw new ApiError(response.status, { success: false, error: 'INVALID_JSON' } as T, 'INVALID_JSON')
  }

  if (!response.ok || data.success === false) {
    throw new ApiError(response.status, data, data.error)
  }

  return data
}

/**
 * Make a POST request with JSON body.
 */
export async function apiPost<T extends ApiResponse>(
  url: string,
  body: Record<string, unknown>,
  options?: Omit<RequestInit, 'method' | 'body'>
): Promise<T> {
  return apiRequest<T>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    body: JSON.stringify(body),
    ...options,
  })
}

/**
 * Make a PATCH request with JSON body.
 */
export async function apiPatch<T extends ApiResponse>(
  url: string,
  body: Record<string, unknown>,
  options?: Omit<RequestInit, 'method' | 'body'>
): Promise<T> {
  return apiRequest<T>(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    body: JSON.stringify(body),
    ...options,
  })
}

/**
 * Make a DELETE request.
 */
export async function apiDelete<T extends ApiResponse>(
  url: string,
  options?: Omit<RequestInit, 'method'>
): Promise<T> {
  return apiRequest<T>(url, {
    method: 'DELETE',
    ...options,
  })
}

/**
 * Make a POST request with FormData body.
 * Used for file uploads.
 */
export async function apiPostForm<T extends ApiResponse>(
  url: string,
  formData: FormData,
  options?: Omit<RequestInit, 'method' | 'body'>
): Promise<T> {
  return apiRequest<T>(url, {
    method: 'POST',
    body: formData,
    ...options,
  })
}

/**
 * Make a PATCH request with FormData body.
 * Used for file uploads on updates.
 */
export async function apiPatchForm<T extends ApiResponse>(
  url: string,
  formData: FormData,
  options?: Omit<RequestInit, 'method' | 'body'>
): Promise<T> {
  return apiRequest<T>(url, {
    method: 'PATCH',
    body: formData,
    ...options,
  })
}
