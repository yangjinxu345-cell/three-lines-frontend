// functions/api/auth/login.js

function json(headers, status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

function generateToken() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function makeCookie(token, maxAgeSeconds = 30 * 24 * 60 * 60) {
  return [
    `session_token=${encodeURIComponent(token)}`,
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ].join("; ");
}

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json(headers, 405, { ok: false, error: "Method Not Allowed" });

  try {
    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return json(headers, 400, { ok: false, error: "用户名或密码为空" });
    }

    // ✅ 明文密码校验：users.password_text
    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, password_text, is_active
      FROM users
      WHERE username = ?
      LIMIT 1
    `).bind(username).first();

    if (!user) return json(headers, 401, { ok: false, error: "用户名或密码错误" });
    if (user.is_active === 0) return json(headers, 403, { ok: false, error: "账号已停用" });

    const stored = String(user.password_text || "");
    if (stored !== password) {
      return json(headers, 401, { ok: false, error: "用户名或密码错误" });
    }

    // ✅ 写入 sessions(token, user_id, expires_at)
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30天

    await env.DB.prepare(`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(token, user.id, expiresAt).run();

    const setCookie = makeCookie(token);

    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          role: user.role,
        },
      }),
      {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": setCookie,
        },
      }
    );
  } catch (e) {
    return json(headers, 500, { ok: false, error: e?.message || String(e) });
  }
}
