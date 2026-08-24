const CACHE_NAME = 'saltbloc-cache-v3';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './offline.html',
    './styles.css',
    './script.js',
    './manifest.json',
    './saltbloc-192.png',
    './saltbloc-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // For navigation requests, try network first, then cache, then offline page
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // optionally update cache for navigations
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => { });
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(request);
                    return cached || caches.match('./offline.html');
                })
        );
        return;
    }

    // For non-navigation assets: cache-first, then network
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            return cachedResponse || fetch(request).then((response) => {
                // optionally cache successful GET assets
                if (request.method === 'GET' && response && response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => { });
                }
                return response;
            });
        }).catch(() => {
            // last resort: if requesting an image or other asset and offline, just fail silently
            return caches.match(request);
        })
    );
});