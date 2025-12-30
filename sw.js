const CACHE_NAME = "three-lines-v2";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/login.html",
  "/account.html",
  "/admin_users.html",
  "/posts.html",
  "/questions.html",
  "/question.html",
  "/quizzes.html",
  "/reminders.html",
  "/ranking.html",
  "/settings.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// 安装：预缓存
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// 激活：清旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

// fetch
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  // API：永远走网络
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // HTML：network-first（更新友好）
  if (req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 其他静态资源：cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      return (
        cached ||
        fetch(req).then((res) => {
          if (res.ok && req.method === "GET") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
      );
    })
  );
});
