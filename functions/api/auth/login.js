// functions/api/auth/login.js

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) {
      return json({ ok: false, error: "DB binding missing" }, 500, headers);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
    }

    const body = await safeJson(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body" }, 400, headers);
    }

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();

    if (!username || !password) {
      return json({ ok: false, error: "Missing username or password" }, 400, headers);
    }

    // 1) 查用户
    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, password_text, is_active
      FROM users
      WHERE username = ?
      LIMIT 1
    `).bind(username).first();

    if (!user) {
      return json({ ok: false, error: "Invalid credentials" }, 401, headers);
    }

    if (user.is_active !== 1) {
      return json({ ok: false, error: "User is disabled" }, 403, headers);
    }

    // 2) 明文密码对比（路线 A）
    if (user.password_text !== password) {
      return json({ ok: false, error: "Invalid credentials" }, 401, headers);
    }

    // 3) 创建 session
    const token =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");

    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expiresAt = expires.toISOString();

    await env.DB.prepare(`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(token, user.id, expiresAt).run();

    // 4) 设置 Cookie（全路径）
    const cookie =
      `session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${7 * 24 * 60 * 60}`;

    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          role: user.role,
        }
      }),
      {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": cookie,
        },
      }
    );

  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* ===== helpers ===== */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function corsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

async function safeJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
