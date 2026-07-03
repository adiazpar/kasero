/**
 * Deduplicated fetch wrapper
 *
 * Prevents duplicate concurrent requests to the same URL.
 * If a request to the same URL is already in-flight, returns the same promise.
 */

import { apiUrl } from './api-origin'
import { getBearerToken } from './native/auth-token'

// Track in-flight GET requests by URL
const inFlightRequests = new Map<string, Promise<Response>>()

// Native (Capacitor) builds attach the bearer session token; on web
// getBearerToken() is always null and `init` passes through untouched.
function withNativeAuth(init?: RequestInit): RequestInit | undefined {
  const bearerToken = getBearerToken()
  if (!bearerToken) return init
  const headers = new Headers(init?.headers)
  if (!headers.has('authorization')) {
    headers.set('Authorization', `Bearer ${bearerToken}`)
  }
  return { ...init, headers }
}

/**
 * Fetch with automatic deduplication for GET requests.
 * POST/PUT/DELETE requests are never deduplicated.
 */
export async function fetchDeduped(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // apiUrl() is the identity on web; on native it resolves relative /api
  // paths against the deployed API origin.
  const url = apiUrl(typeof input === 'string' ? input : input.toString())
  const method = init?.method?.toUpperCase() || 'GET'

  // Only dedupe GET requests
  if (method !== 'GET') {
    return fetch(url, withNativeAuth(init))
  }

  // Check if request is already in-flight
  const existing = inFlightRequests.get(url)
  if (existing) {
    // Return clone of the response (Response can only be read once)
    return existing.then(res => res.clone())
  }

  // Create new request and track it
  const request = fetch(url, withNativeAuth(init)).then(response => {
    // Remove from tracking after a small delay to catch rapid duplicate calls
    setTimeout(() => inFlightRequests.delete(url), 100)
    return response
  }).catch(error => {
    inFlightRequests.delete(url)
    throw error
  })

  inFlightRequests.set(url, request)
  return request.then(res => res.clone())
}
