// =============================================================================
// RapidRelay Service Worker
// Provides offline capability with cache-first strategy for static assets
// and network-first for API/data requests.
// =============================================================================

const CACHE_NAME = "rapidrelay-v1"
const OFFLINE_URL = "/"

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
]

// Install: pre-cache critical assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn("[SW] Pre-cache partial failure:", err)
        // Don't block install if some assets fail
      })
    })
  )
  // Activate immediately (don't wait for old SW to die)
  self.skipWaiting()
})

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  )
  // Claim all open clients immediately
  self.clients.claim()
})

// Fetch strategy:
// - Navigation requests: network-first, fall back to cache
// - Static assets (JS, CSS, images): cache-first, fall back to network
// - Other (API, etc.): network-first, fall back to cache
self.addEventListener("fetch", (event) => {
  const { request } = event

  // Skip non-GET requests
  if (request.method !== "GET") return

  // Skip chrome-extension and other non-http schemes
  if (!request.url.startsWith("http")) return

  // Navigation requests (HTML pages)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful navigation responses
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => {
          return caches.match(OFFLINE_URL).then(
            (cached) => cached || new Response("Offline", { status: 503 })
          )
        })
    )
    return
  }

  // Static assets: cache-first
  if (
    request.url.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot)(\?.*)?$/)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
            }
            return response
          })
      )
    )
    return
  }

  // Everything else: network-first
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || new Response("Offline", { status: 503 })))
  )
})
