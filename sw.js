// sw.js (Service Worker) - v3
const CACHE_NAME = "three-lines-cache-v3";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/login.html",
  "/account.html",
  "/posts.html",
  "/posts_new.html",
  "/posts_modify.html",
  "/admin_users.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// network-first for HTML navigations, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 不拦截跨域
  if (url.origin !== self.location.origin) return;

  // API 永远走网络（并且不缓存）
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  const accept = req.headers.get("accept") || "";
  const isHTML = req.mode === "navigate" || accept.includes("text/html");

  // HTML：network-first（关键）
  if (isHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match("/index.html");
      }
    })());
    return;
  }

  // 其他静态资源：cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    // 只缓存 GET
    if (req.method === "GET" && res && res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  })());
});
