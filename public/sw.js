// dlala-nextjs service worker — IMAGE CACHE ONLY (Zak ordered 14 Oct 2026).
//
// Mirrors production 0.0.0.39's proven dlala-img-v1 strategy: listing photos
// are immutable token URLs, so repeat views load them from cache (~50ms)
// instead of the network (~1.4s on slow links). First visit is unchanged.
//
// Deliberately minimal: ONLY cross-origin listing-photo GETs are intercepted
// (cache-first). Everything else (HTML navigations, _next chunks, API, Firestore)
// passes straight through to the network — zero risk to routing, RSC, auth,
// or the lazy Firebase/gstatic boundary (this file imports nothing).
//
// Hosts: firebasestorage.googleapis.com (legacy listing photos) and
// img.dzdlala.com (R2_PUBLIC_URL — new uploads). If R2_PUBLIC_URL ever changes,
// update IMG_HOSTS below.

const IMG_CACHE = 'dlala-next-img-v1';
const IMG_HOSTS = new Set(['firebasestorage.googleapis.com', 'img.dzdlala.com']);
const IMG_CACHE_MAX = 100; // bound growth (production lesson 16 Sep 2026)

self.addEventListener('install', (e) => {
  // Activate immediately — no precache, nothing to wait for.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Preserve the image cache across SW updates (production lesson
        // 15 Sep 2026: the cache only pays off if it survives updates).
        Promise.all(keys.filter((k) => k !== IMG_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

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
              // Bound the cache — keep the newest 100.
              c.keys()
                .then((keys) => {
                  if (keys.length > IMG_CACHE_MAX) c.delete(keys[0]).catch(() => {});
                })
                .catch(() => {});
            }
            return res;
          });
        }),
      ),
    );
  }
  // Every other request: fall through to the network untouched.
});
