// sw.js (UPDATED)
// 只缓存静态资源；/api/* 永远走网络（不缓存），避免“换账号但用户不变”的问题。

const CACHE_VERSION = "v3"; // 改版本号 -> 强制更新 SW 缓存
const CACHE_NAME = `three-lines-cache-${CACHE_VERSION}`;

// 只预缓存静态资源（按需增减）
// 注意：不要把 /api/* 放进来
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
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // 清理旧缓存
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("three-lines-cache-") && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  // ✅ 关键：/api/* 一律不缓存，直接打到网络
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  // 对非 GET 请求不做缓存
  if (req.method !== "GET") {
    event.respondWith(fetch(req));
    return;
  }

  // HTML 页面：Network First（保证更新及时）
  const accept = req.headers.get("accept") || "";
  const isHTML = req.mode === "navigate" || accept.includes("text/html");

  if (isHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // 其他静态资源：Cache First
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
