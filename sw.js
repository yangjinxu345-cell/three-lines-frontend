const CACHE_NAME = "three-lines-v1";

// 先缓存：入口 + 各页面（你现在的多页面结构很适合这样做）
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/login",
  "/account.html",
  "/admin_users",
  "/posts.html",
  "/questions.html",
  "/question.html",
  "/quizzes.html",
  "/reminders.html",
  "/ranking.html",
  "/settings.html",
  "/manifest.webmanifest"
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

// fetch：
// - HTML/静态资源：cache-first（离线可打开）
// - /api/*：network-only（避免缓存登录态/数据错乱）
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  // API 不缓存
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // 只缓存成功且 GET 的响应
        if (req.method === "GET" && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
