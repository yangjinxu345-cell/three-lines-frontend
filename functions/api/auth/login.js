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
    if (!username || !password) return json({ ok: false, error: "Missing username/password" }, 400, headers);

    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, password_hash, password_salt
      FROM users
      WHERE username = ?
    `).bind(username).first();

    if (!user) return json({ ok: false, error: "Invalid credentials" }, 401, headers);

    // ---- 1) verify (兼容旧数据) ----
    let verified = false;

    const hash = String(user.password_hash ?? "").trim();
    const salt = String(user.password_salt ?? "").trim();

    const looksLegacy =
      !hash || !salt || hash === "admin" || salt === "admin" || hash.length < 32 || salt.length < 8;

    if (looksLegacy) {
      // 旧数据：先用“明文==password_hash”或“明文==username”等方式兜底一次
      // 你的截图里 hash/salt 都是 "admin"：所以 admin/admin 会通过
      if (password === hash || password === salt) verified = true;
    } else {
      verified = await verifyPasswordPBKDF2(password, salt, hash);
    }

    if (!verified) return json({ ok: false, error: "Invalid credentials" }, 401, headers);

    // ---- 2) 若是旧数据，登录成功后立刻升级为 PBKDF2 ----
    if (looksLegacy) {
      const newSalt = makeSalt(16);
      const newHash = await hashPasswordPBKDF2(password, newSalt);
      await env.DB.prepare(`
        UPDATE users
        SET password_salt = ?, password_hash = ?
        WHERE id = ?
      `).bind(newSalt, newHash, user.id).run();
    }

    // ---- 3) create session (与你的 sessions 表一致：token/user_id/expires_at) ----
    const sessionToken = bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)));
    const ttlSec = 60 * 60 * 24 * 7; // 7 days
    const expIso = new Date(Date.now() + ttlSec * 1000).toISOString();

    await env.DB.prepare(`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(sessionToken, user.id, expIso).run();

    // ---- 4) Set-Cookie（关键：Path=/）----
    const cookie =
      `session=${encodeURIComponent(sessionToken)}; ` +
      `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSec}`;

    return json(
      { ok: true, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } },
      200,
      { ...headers, "Set-Cookie": cookie }
    );
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
async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
}
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
function bytesToB64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function makeSalt(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  // 用 hex 方便存储
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

const PBKDF2_ITER = 100000; // ✅ Cloudflare 上限内

async function hashPasswordPBKDF2(password, saltHex) {
  const enc = new TextEncoder();
  const salt = enc.encode(saltHex);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    key,
    256
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPasswordPBKDF2(password, saltHex, storedHashHex) {
  const h = await hashPasswordPBKDF2(password, saltHex);
  return h === String(storedHashHex);
}
