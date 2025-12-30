// functions/api/auth/login.js
import { corsHeaders, corsPreflight, json } from "../../_lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);
    if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405, headers);

    const body = await safeJson(request);
    if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    if (!username || !password) return json({ ok: false, error: "Missing username/password" }, 400, headers);

    // 1) 查 user
    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, password_hash, password_salt
      FROM users
      WHERE username = ?
      LIMIT 1
    `).bind(username).first();

    if (!user) return json({ ok: false, error: "Invalid credentials" }, 401, headers);

    // 2) 校验密码（你已有逻辑就用你自己的）
    // 这里为了不破坏你现状：先允许 password_hash='admin' 的临时账号
    const ok = (user.password_hash === password) || (user.password_hash === "admin" && password === "admin");
    if (!ok) return json({ ok: false, error: "Invalid credentials" }, 401, headers);

    // 3) 生成 session token + 写入 sessions
    const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 3600 * 1000); // 7天
    const expiresAt = expires.toISOString();

    await env.DB.prepare(`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(token, user.id, expiresAt).run();

    // ✅ 4) 设置 Cookie —— 关键是 Path=/
    const cookie =
      `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": cookie,
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
}
