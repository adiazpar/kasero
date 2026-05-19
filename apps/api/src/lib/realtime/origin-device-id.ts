import 'server-only'

/**
 * Reads the X-Device-Id header attached by the web client. Returns
 * undefined when absent, empty, or whitespace-only.
 *
 * The publisher passes this through onto the event payload so the
 * publishing client can suppress its own echo.
 *
 * NOT an authentication factor. Trivially forgeable. The realtime
 * client uses it only for self-echo filtering.
 */
export function getOriginDeviceId(request: Request): string | undefined {
  const v = request.headers.get('x-device-id')
  if (!v) return undefined
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
