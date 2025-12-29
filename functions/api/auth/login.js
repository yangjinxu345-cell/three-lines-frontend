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

    // 1) get user
    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, password_hash, password_salt
      FROM users
      WHERE username = ?
    `).bind(username).first();

    if (!user) return json({ ok: false, error: "Invalid username or password" }, 401, headers);

    // 2) verify password (robust: avoid atob crash)
    const storedHash = (user.password_hash ?? "").toString();
    const storedSalt = (user.password_salt ?? "").toString();

    let ok = false;
    let needUpgrade = false;

    // --- Case A: legacy/plaintext bootstrap (your current DB: admin/admin) ---
    // If salt/hash is not valid base64, we treat it as legacy and allow:
    //   password === storedHash  (or password === storedSalt)
    if (!isBase64Like(storedHash) || !isBase64Like(storedSalt)) {
      if (password === storedHash || password === storedSalt) {
        ok = true;
        needUpgrade = true; // upgrade to secure hash after first login
      } else {
        return json({ ok: false, error: "Invalid username or password" }, 401, headers);
      }
    } else {
      // --- Case B: normal secure verify (PBKDF2) ---
      const saltBytes = b64ToBytes(storedSalt);
      const expected = storedHash;
      const derived = await pbkdf2Base64(password, saltBytes, 150000, 32);
      ok = (derived === expected);
      if (!ok) return json({ ok: false, error: "Invalid username or password" }, 401, headers);
    }

    // 3) upgrade legacy password to PBKDF2 storage (one-time)
    if (needUpgrade) {
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const newSaltB64 = bytesToB64(saltBytes);
      const newHashB64 = await pbkdf2Base64(password, saltBytes, 150000, 32);

      await env.DB.prepare(`
        UPDATE users
        SET password_salt = ?, password_hash = ?
        WHERE id = ?
      `).bind(newSaltB64, newHashB64, user.id).run();
    }

    // 4) create session
    // sessionToken: random 32 bytes base64url
    const sessionToken = bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256Hex(sessionToken);

    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 3600 * 1000); // 7 days
    const nowIso = now.toISOString();
    const expIso = expires.toISOString();

    // Try insert into sessions table (common schema)
    // If your sessions table columns differ, tell me your CREATE TABLE, I'll align it.
    await env.DB.prepare(`
      INSERT INTO sessions (user_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind(user.id, tokenHash, nowIso, expIso).run();

    // 5) set cookie (HttpOnly)
    const cookie = [
      `session=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${7 * 24 * 3600}`,
    ].join("; ");

    const resHeaders = {
      ...headers,
      "Set-Cookie": cookie,
    };

    // 6) (optional) audit log - ignore failure if table differs
    try {
      const ip = request.headers.get("CF-Connecting-IP") || "";
      const ua = request.headers.get("User-Agent") || "";
      await env.DB.prepare(`
        INSERT INTO audit_logs (user_id, action, ip, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(user.id, "login", ip, ua, nowIso).run();
    } catch {}

    return json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      }
    }, 200, resHeaders);

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

// base64 checks
function isBase64Like(s) {
  if (!s || typeof s !== "string") return false;
  // allow base64 + '=' padding
  if (s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(s);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function bytesToB64Url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pbkdf2Base64(password, saltBytes, iterations, keyLenBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    keyLenBytes * 8
  );
  return bytesToB64(new Uint8Array(bits));
}

async function sha256Hex(s) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  const bytes = new Uint8Array(buf);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
