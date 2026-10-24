// dlala-nextjs service worker — image cache + offline navigation.
//
// History: IMAGE CACHE ONLY per Zak's order of 14 Oct 2026 (listing
// photos are immutable token URLs; repeat views load from cache).
// R24-3 (Zak approved 24 Oct 2026): scope widened so offline
// navigation stays in-app — previously visited pages keep working
// without a connection instead of dropping to the browser's offline
// dinosaur. Images still cache-first exactly as before.
//
// Deliberately minimal, and the lazy Firebase boundary is untouched:
// this file imports nothing, and it NEVER intercepts API routes,
// Firestore, or gstatic — only (a) cross-origin listing-photo GETs
// (cache-first, as before), (b) same-origin document navigations
// (network-first with cache fallback), and (c) same-origin
// /_next/static/* chunks (cache-first — content-hashed, immutable).
// Everything else passes straight through to the network.
//
// Navigation semantics (read before changing):
// - ONLINE: network-first, always. The cache never serves a stale page
//   while the network works, and every successful navigation refreshes
//   its cache entry. Only res.ok same-origin documents are stored
//   (error pages and redirects are never cached).
// - OFFLINE: the cached copy of a previously visited page is served.
//   A never-visited page still fails (no precache — install stays
//   instant and costs zero bandwidth on weak connections, per the
//   خفف rule; precaching would also burn metered data for pages the
//   user may never open).
// - Cached pages are per-device (this browser profile only). A cached
//   authenticated shell can only ever be served back to the same
//   device that built it, and the next online visit refreshes it.
// - Client-side (RSC) navigations are fetch requests, not document
//   navigations (mode !== 'navigate'), so they are untouched here.
//
// Hosts: firebasestorage.googleapis.com (legacy listing photos) and
// the R2 public bucket host (R2_PUBLIC_URL — new uploads; production value
// is the pub-*.r2.dev host written into every R2 listing's photoUrls —
// audit round 19 found IMG_HOSTS still named only the planned
// img.dzdlala.com, so NO R2 photo was ever cached). If R2_PUBLIC_URL
// changes, update IMG_HOSTS below.

const IMG_CACHE = 'dlala-next-img-v1';
const IMG_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'img.dzdlala.com',
  'pub-bf326f03c4774a4287a473be0a7de582.r2.dev',
]);
const IMG_CACHE_MAX = 100; // bound growth (production lesson 16 Sep 2026)

const NAV_CACHE = 'dlala-next-nav-v1';
const NAV_CACHE_MAX = 50; // bound growth; oldest entries evicted first
const STATIC_CACHE = 'dlala-next-static-v1';
const STATIC_CACHE_MAX = 100;

self.addEventListener('install', (e) => {
  // Activate immediately — no precache, nothing to wait for.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Preserve the image, navigation, and static caches across SW
        // updates (production lesson 15 Sep 2026: a cache only pays
        // off if it survives updates).
        Promise.all(
          keys
            .filter((k) => k !== IMG_CACHE && k !== NAV_CACHE && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim()),
  );
});

function trimCache(cache, max) {
  return cache
    .keys()
    .then((keys) => {
      if (keys.length <= max) return;
      // Cache keys() returns insertion order — keys[0] is oldest.
      return cache.delete(keys[0]).catch(() => {});
    })
    .catch(() => {});
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Images only: GET + known photo host. <img> requests are no-cors, so
  // responses are opaque — cacheable (res.ok is false for opaque).
  if (e.request.method === 'GET' && IMG_HOSTS.has(url.hostname)) {
    e.respondWith(
      caches.open(IMG_CACHE).then((c) =>
        c.match(e.request).then((hit) => {
          if (hit) return hit;
          return fetch(e.request).then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              const copy = res.clone();
              c.put(e.request, copy).catch(() => {});
              trimCache(c, IMG_CACHE_MAX);
            }
            return res;
          });
        }),
      ),
    );
    return;
  }
  // Same-origin only from here — cross-origin non-image traffic is
  // never intercepted (Firebase, analytics, everything else).
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // R24-3: document navigations — network-first, cache fallback.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches
              .open(NAV_CACHE)
              .then((c) => {
                c.put(e.request, copy).catch(() => {});
                trimCache(c, NAV_CACHE_MAX);
              })
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.open(NAV_CACHE).then((c) => c.match(e.request)).then((hit) => {
            if (hit) return hit;
            throw new Error('offline and no cached page');
          })
        ),
    );
    return;
  }
  // R24-3: immutable hashed chunks — cache-first. /_next/static/*
  // filenames embed their content hash, so a cached chunk can never be
  // stale; caching them is what makes an offline cached page actually
  // render instead of a bare shell.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.open(STATIC_CACHE).then((c) =>
        c.match(e.request).then((hit) => {
          if (hit) return hit;
          return fetch(e.request).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              c.put(e.request, copy).catch(() => {});
              trimCache(c, STATIC_CACHE_MAX);
            }
            return res;
          });
        }),
      ),
    );
  }
  // Every other request: fall through to the network untouched
  // (API routes, Firestore, RSC navigations, same-origin images).
});
