// login.js
(() => {
  const $ = (id) => document.getElementById(id);

  async function apiMe() {
    const r = await fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "include",
    });
    const j = await r.json();
    return j && j.ok ? j.user : null;
  }

  async function doLogin(username, password) {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
      credentials: "include",
    });
    const j = await r.json().catch(() => null);
    return { r, j };
  }

  function getNext() {
    const sp = new URLSearchParams(location.search);
    const n = sp.get("next");
    if (n && n.startsWith("/")) return n;
    return "/index.html";
  }

  // 如果已登录，直接去 index
  (async () => {
    try {
      const user = await apiMe();
      if (user) location.replace(getNext());
    } catch {}
  })();

  // 绑定表单
  const form = document.querySelector("form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("msg");
    const btn = $("btnLogin") || document.querySelector('button[type="submit"]');

    msg && (msg.textContent = "");
    btn && (btn.disabled = true);

    try {
      const username = ($("username") || $("u") || document.querySelector('input[name="username"]')).value.trim();
      const password = ($("password") || $("p") || document.querySelector('input[type="password"]')).value.trim();

      const { r, j } = await doLogin(username, password);

      if (!r.ok || !j || !j.ok) {
        if (msg) msg.textContent = (j && j.error) ? j.error : `Login failed: ${r.status}`;
        return;
      }

      // ✅ 永远不要跳到 "/"，否则会被 _redirects 再送回登录页
      location.replace(getNext());
    } catch (err) {
      if (msg) msg.textContent = String(err);
    } finally {
      btn && (btn.disabled = false);
    }
  });
})();
