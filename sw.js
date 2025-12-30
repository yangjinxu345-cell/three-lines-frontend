// sw.js
// 关键点：
// 1) /api/* 永远不缓存
// 2) HTML 导航请求（document）使用 Network First，避免旧缓存造成“登录后仍回登录页”
// 3) 静态资源（图片/CSS/JS）使用 Cache First
// 4) bump 版本号强制刷新缓存



const CACHE_NAME = "three-lines-v2";

const PRECACHE_URLS = [
  "/index.html",
  "/login.html",
  "/account.html",
  "/admin_users.html",
  "/posts.html",
  "/posts_new.html",
  "/posts_modify.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只处理同源
  if (url.origin !== self.location.origin) return;

  // /api/* 不缓存，直接走网络
  if (url.pathname.startsWith("/api/")) return;

  const accept = req.headers.get("accept") || "";
  const isHTML =
    req.mode === "navigate" ||
    accept.includes("text/html") ||
    url.pathname.endsWith(".html");

  // HTML：Network First（避免旧缓存导致登录逻辑不更新）
  if (isHTML) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (e) {
          const cached = await caches.match(req);
          if (cached) return cached;
          // 最后兜底：给 index.html（或 login.html）也行，但这里给 index.html
          return caches.match("/index.html");
        }
      })()
    );
    return;
  }

  // 其它静态资源：Cache First
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (req.method === "GET" && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
