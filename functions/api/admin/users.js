// functions/api/admin/users.js

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);

    // admin 必须登录
    const me = await requireAdmin(request, env);
    if (!me.ok) return json({ ok: false, error: me.error }, me.status, headers);

    if (request.method === "GET") {
      const rows = await env.DB.prepare(`
        SELECT id, username, display_name, role, is_active, created_at, updated_at
        FROM users
        ORDER BY id ASC
      `).all();

      return json({ ok: true, items: rows.results || [] }, 200, headers);
    }

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const username = str(body.username, 1, 50);
      const display_name = str(body.display_name, 1, 80);
      const role = str(body.role, 1, 20) || "student";
      const password = str(body.password || body.password_text || body.initial_password, 1, 200);

      if (!username || !display_name || !password) {
        return json({ ok: false, error: "Missing: username, display_name, password" }, 400, headers);
      }
      if (!["student", "teacher", "admin"].includes(role)) {
        return json({ ok: false, error: "role must be student/teacher/admin" }, 400, headers);
      }

      // ✅ 路线A：明文密码写入 password_text
      // ✅ 同时满足 NOT NULL：占位写入 hash/salt/iters
      await env.DB.prepare(`
        INSERT INTO users (
          username, display_name, role,
          password_text,
          password_hash, password_salt, password_iters,
          is_active, created_at, updated_at
        )
        VALUES (
          ?, ?, ?,
          ?,
          '', '', 0,
          1, (strftime('%Y-%m-%dT%H:%M:%fZ','now')), NULL
        )
      `).bind(username, display_name, role, password).run();

      return json({ ok: true }, 201, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* ================= helpers ================= */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  try { return await req.json(); } catch { return null; }
}
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/* ===== session/auth (admin only) ===== */

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    out[k] = v;
  }
  return out;
}

async function requireAdmin(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.session || ""; // login.js 设置的是 session=...

  if (!token) return { ok: false, status: 401, error: "Not logged in" };

  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
      AND s.expires_at > ?
    LIMIT 1
  `).bind(token, now).first();

  if (!row) return { ok: false, status: 401, error: "Not logged in" };
  if (row.role !== "admin") return { ok: false, status: 403, error: "Forbidden (admin only)" };

  return { ok: true, user: row };
}
