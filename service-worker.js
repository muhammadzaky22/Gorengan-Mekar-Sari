const CACHE = "gorengan-mekarsari-v8-live-orders";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./admin-manifest.json",
  "./stok-config.js",
  "./icon-192.png",
  "./icon-512.png",
  "./gorengan-mekarsari-preview.webp",
  "./admin-stok.html",
  "./admin.html",
  "./admin-app.css",
  "./admin-app.js",
  "./firebase-config.js",
  "./database.js",
  "./store-enhancements.css",
  "./store-enhancements.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    fetch(req)
      .then(response => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => caches.match(req).then(cached => cached || caches.match("./index.html")))
  );
});
