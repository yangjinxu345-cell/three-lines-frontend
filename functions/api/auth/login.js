// functions/api/auth/login.js
import { corsPreflight } from "../../_lib/auth.js";

function buildCorsHeaders(request) {
  const origin = request.headers.get("Origin");
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

// 简单 hash（示例保持你现有风格：token 自己生成，存 DB；这里不动你的密码体系）
function randToken(len = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = buildCorsHeaders(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const username = String(body?.username || "").trim();
  const password = String(body?.password || "").trim();

  if (!username || !password) {
    return new Response(JSON.stringify({ ok: false, error: "Missing username/password" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // 你现在已经走 password_text 方案：这里按 password_text 校验（如你项目已改成这样）
  const u = await env.DB.prepare(
    `SELECT id, username, display_name, role, is_active, password_text FROM users WHERE username = ?`
  ).bind(username).first();

  if (!u || u.is_active !== 1 || u.password_text !== password) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid credentials" }), {
      status: 401,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // 生成 session token 并存 DB
  const token = randToken(48);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(); // 30天

  await env.DB.prepare(
    `INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, ?)`
  ).bind(token, u.id, expiresAt).run();

  // Set-Cookie（与 logout 属性保持一致）
  const cookie = [
    `session=${encodeURIComponent(token)}`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Max-Age=${60 * 60 * 24 * 30}`,
  ].join("; ");

  return new Response(JSON.stringify({
    ok: true,
    user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role }
  }), {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
    },
  });
}
