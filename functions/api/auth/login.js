export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);
    if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405, headers);

    const body = await safeJson(request);
    if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

    const username = str(body.username, 1, 50);
    const password = str(body.password, 1, 200);
    if (!username || !password) return json({ ok: false, error: "Missing: username/password" }, 400, headers);

    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, password_hash, password_salt
      FROM users
      WHERE username = ?
    `).bind(username).first();

    if (!user) return json({ ok: false, error: "Invalid credentials" }, 401, headers);

    const ok = await verifyPassword(password, user.password_hash, user.password_salt);
    if (!ok) return json({ ok: false, error: "Invalid credentials" }, 401, headers);

    // create session
    const token = randomToken();
    const nowIso = isoNow();
    const expiresIso = isoAfterDays(7);

    await env.DB.prepare(`
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind(token, user.id, nowIso, expiresIso).run();

    // If legacy (hash/salt are plain), upgrade to PBKDF2 hash
    if (String(user.password_hash) === String(user.password_salt) && String(user.password_hash) === password) {
      const { hashB64, saltB64 } = await hashPasswordPBKDF2(password);
      await env.DB.prepare(`
        UPDATE users SET password_hash=?, password_salt=? WHERE id=?
      `).bind(hashB64, saltB64, user.id).run();
    }

    const cookie = makeSessionCookie(token);

    return new Response(JSON.stringify({
      ok: true,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
      expires_at: expiresIso
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...headers,
        "Set-Cookie": cookie,
      }
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* ---------------- helpers ---------------- */

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
async function safeJson(req) { try { return await req.json(); } catch { return null; } }
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function makeSessionCookie(token) {
  // pages.dev is https, so Secure is OK.
  return `session_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
}
function randomToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return b64url(a);
}
function b64url(bytes) {
  const bin = String.fromCharCode(...bytes);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64;
}
function isoNow() {
  return new Date().toISOString();
}
function isoAfterDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// PBKDF2: iterations <= 100000 (Cloudflare limitation in your env)
const PBKDF2_ITER = 100000;
const PBKDF2_LEN = 32; // 256-bit
async function hashPasswordPBKDF2(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER },
    key,
    PBKDF2_LEN * 8
  );
  const hash = new Uint8Array(bits);

  return { hashB64: toB64(hash), saltB64: toB64(salt) };
}

async function verifyPassword(password, hashB64, saltB64) {
  // legacy: both are same and equals plaintext
  if (String(hashB64) === String(saltB64) && String(hashB64) === String(password)) return true;

  // pbkdf2 mode
  let salt;
  let expected;
  try {
    salt = fromB64(saltB64);
    expected = fromB64(hashB64);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER },
    key,
    expected.length * 8
  );
  const got = new Uint8Array(bits);
  return timingSafeEqual(got, expected);
}

function toB64(u8) {
  const bin = String.fromCharCode(...u8);
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(String(b64));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]);
  return diff === 0;
}
