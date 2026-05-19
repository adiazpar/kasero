/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute, Route } from 'workbox-routing'
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope

// Precache the SPA shell + assets injected by vite-plugin-pwa at build time.
// `__WB_MANIFEST` is replaced by the plugin with the actual asset list during
// `vite build` (injectManifest mode).
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Bypass the service worker entirely for the realtime SSE stream. Even
// NetworkOnly through Workbox introduces a fetch() indirection that some
// browsers (notably Safari/iOS) handle awkwardly for long-lived
// text/event-stream responses — the SW's fetch can buffer chunks or
// interfere with the browser's native reconnect on network flap.
// Returning without calling event.respondWith() lets the browser go
// direct to the origin.
//
// Manual verification: build the app, install the SW, open DevTools →
// Network, reload. The /api/realtime request must NOT show "(service worker)"
// in its Initiator column.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname === '/api/realtime') {
    return
  }
})

// CRITICAL: never cache `/api/*` — the API must always hit network so writes,
// authenticated reads, and rate-limit headers are never served stale. This
// route is registered FIRST so it wins over the navigation handler below.
registerRoute(
  new Route(
    ({ url }) => url.pathname.startsWith('/api/'),
    new NetworkOnly(),
  ),
)

// SPA navigation fallback: deep URLs (e.g. `/<businessId>/products`) serve the
// precached `index.html` so React Router can resolve client-side. The denylist
// keeps `/api/*` out of this handler as a defense-in-depth measure.
registerRoute(
  new NavigationRoute(
    async () => {
      const cached = await caches.match('/index.html')
      if (cached) return cached
      return fetch('/index.html')
    },
    { denylist: [/^\/api\//] },
  ),
)

// Image caching for product/business icons + static logos. Cache-first because
// product icons are content-addressed (`?v=<timestamp>` cache buster on
// upload), so a cache hit is always correct.
//
// Scoped to same-origin for the same reason as the script/style route below:
// cross-origin images (e.g. Google OAuth avatars at lh3.googleusercontent.com)
// would otherwise be fetched through worker context and trip CSP `connect-src`
// instead of falling under `img-src`. Same-origin matches the documented
// intent — only icons under `/media/...` are meant to be SW-cached.
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin && request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
)

// Static assets that fall outside the precache (e.g. dynamically-imported
// chunks loaded after a deploy). Stale-while-revalidate keeps the UI snappy
// while quietly fetching the latest version in the background.
//
// Scoped to same-origin so the SW doesn't intercept cross-origin CSS/JS
// (e.g. the Google Fonts stylesheet linked from index.html). Letting the
// browser fetch those directly avoids a CSP `connect-src` violation — the
// SW's revalidating fetch runs in worker-script context, which is governed
// by `connect-src` rather than the original request's `style-src`/`script-src`.
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    (request.destination === 'script' || request.destination === 'style'),
  new StaleWhileRevalidate({ cacheName: 'static-resources' }),
)

self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
