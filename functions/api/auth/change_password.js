export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);
    if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405, headers);

    const token = readCookie(request.headers.get("Cookie") || "", "session_token");
    if (!token) return json({ ok: false, error: "Not logged in" }, 401, headers);

    const me = await env.DB.prepare(`
      SELECT u.id, u.username, u.role, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).bind(token).first();

    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);
    if (String(me.expires_at) <= new Date().toISOString()) {
      await env.DB.prepare(`DELETE FROM sessions WHERE token=?`).bind(token).run();
      return json({ ok: false, error: "Session expired" }, 401, headers);
    }

    const body = await safeJson(request);
    if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

    const newPassword = str(body.new_password, 6, 200);
    if (!newPassword) return json({ ok: false, error: "Missing: new_password (min 6 chars)" }, 400, headers);

    const { hashB64, saltB64 } = await hashPasswordPBKDF2(newPassword);

    await env.DB.prepare(`
      UPDATE users SET password_hash=?, password_salt=? WHERE id=?
    `).bind(hashB64, saltB64, me.id).run();

    return json({ ok: true }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

function readCookie(cookie, key) {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  return m ? m[1] : "";
}
async function safeJson(req) { try { return await req.json(); } catch { return null; } }
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

const PBKDF2_ITER = 100000;
const PBKDF2_LEN = 32;
async function hashPasswordPBKDF2(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER },
    key,
    PBKDF2_LEN * 8
  );
  const hash = new Uint8Array(bits);
  return { hashB64: toB64(hash), saltB64: toB64(salt) };
}
function toB64(u8) {
  const bin = String.fromCharCode(...u8);
  return btoa(bin);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function corsPreflight() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
