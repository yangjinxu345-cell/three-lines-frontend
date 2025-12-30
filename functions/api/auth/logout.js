// functions/api/auth/logout.js
import { corsPreflight } from "../../_lib/auth.js";

// 解析 Cookie
function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function buildCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  // 同源访问时 Origin 可能为空；这里做成“有就回显”，避免 credentials 场景踩坑
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (origin) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Credentials"] = "true";
    h["Vary"] = "Origin";
  } else {
    h["Access-Control-Allow-Origin"] = "*";
  }
  return h;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();

  const headers = buildCorsHeaders(request);

  // 1) 取出当前 cookie 里的 session token
  const token = getCookie(request, "session");

  // 2) 从 DB 删除 session（非常关键：否则旧 token 仍可能被 /me 识别）
  if (token) {
    try {
      await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    } catch (e) {
      // 删除失败也继续清 cookie（不阻塞登出）
      console.warn("logout: failed to delete session in DB:", e);
    }
  }

  // 3) 强力清 cookie（带 Expires + Max-Age=0 + 同 Path + SameSite + Secure）
  const cookie = [
    `session=`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Max-Age=0`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  ].join("; ");

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      // 防止任何中间层/浏览器缓存 auth 响应
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
    },
  });
}
