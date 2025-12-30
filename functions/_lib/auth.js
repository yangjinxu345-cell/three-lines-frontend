// functions/_lib/auth.js

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
export function corsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

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

/**
 * 兼容多种 token 来源：
 * - Cookie: session / token / session_token / auth_token
 * - Authorization: Bearer <token>
 */
export function getSessionToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();

  const cookies = parseCookies(request.headers.get("Cookie"));
  return (
    cookies.session ||
    cookies.session_token ||
    cookies.token ||
    cookies.auth_token ||
    ""
  );
}

/**
 * 读取 session -> users
 * sessions 表：token, user_id, created_at, expires_at
 */
export async function getUserFromSession(env, token) {
  if (!token) return null;

  // expires_at 你是 TEXT，且是类似 2025-12-29T07:10:26.677Z 这种 ISO
  // 直接用字符串比较 + 当前时间 ISO 是可行的（同格式 lexicographic 可比）
  const now = new Date().toISOString();

  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
      AND s.expires_at > ?
    LIMIT 1
  `).bind(token, now).first();

  return row || null;
}

export async function requireLogin(context) {
  const { request, env } = context;
  const headers = corsHeaders();

  if (!env.DB) return { ok: false, res: json({ ok: false, error: "DB binding missing" }, 500, headers) };

  const token = getSessionToken(request);
  const user = await getUserFromSession(env, token);

  if (!user) {
    return { ok: false, res: json({ ok: false, error: "Not logged in" }, 401, headers) };
  }
  return { ok: true, user, headers };
}

export async function requireAdmin(context) {
  const r = await requireLogin(context);
  if (!r.ok) return r;

  if (r.user.role !== "admin") {
    return { ok: false, res: json({ ok: false, error: "Forbidden (admin only)" }, 403, r.headers) };
  }
  return r;
}

export function clampInt(v, min, max, def) {
  const n = parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
export function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
