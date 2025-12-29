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

    // 1) find user
    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, password_hash, password_salt
      FROM users
      WHERE username = ?
    `).bind(username).first();

    if (!user) return json({ ok: false, error: "Invalid credentials" }, 401, headers);

    // 2) verify password
    const ok = await verifyPassword(password, user.password_salt, user.password_hash);
    if (!ok) return json({ ok: false, error: "Invalid credentials" }, 401, headers);

    // 3) create session token + store to D1 (sessions.token)
    const sessionToken = bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)));
    const now = Date.now();
    const ttlSec = 60 * 60 * 24 * 7; // 7 days
    const expIso = new Date(now + ttlSec * 1000).toISOString();

    await env.DB.prepare(`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(sessionToken, user.id, expIso).run();

    // 4) set cookie (关键：Path=/)
    const cookie =
      `session=${encodeURIComponent(sessionToken)}; ` +
      `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSec}`;

    return json(
      {
        ok: true,
        user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
      },
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

// base64url
function bytesToB64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// PBKDF2 verify：把 iteration 控制在 100000 以下（你之前遇到过 >100000 的报错）
async function verifyPassword(password, salt, storedHash) {
  // 如果你 users 表里现在 password_hash/password_salt 还是 "admin" 这种占位符，
  // 这里会失败；你需要用管理页面把 admin 密码真正设置成 hash 形式。
  // 但你现在能“登录成功”，说明你当前代码可能是明文对比的。
  // 所以：这里给你一个兼容逻辑：如果 storedHash === password_salt === "admin" 这种，就当明文。
  if (storedHash === password && salt === password) return true;

  const iterations = 100000; // ✅ 不要超过 100000
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" },
    key,
    256
  );
  const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex === String(storedHash);
}
