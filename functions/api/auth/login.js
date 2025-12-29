export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);
    if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405, headers);

    const body = await safeJson(request);
    if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

    const username = str(body.username, 1, 80);
    const password = str(body.password, 1, 200);
    if (!username || !password) return json({ ok: false, error: "Missing username/password" }, 400, headers);

    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role, password_hash, password_salt, password_iters, is_active
      FROM users
      WHERE username = ?
      LIMIT 1
    `).bind(username).first();

    if (!user || Number(user.is_active) !== 1) {
      // 不泄露“是否存在该用户名”
      await sleep(150);
      return json({ ok: false, error: "Invalid credentials" }, 401, headers);
    }

    const ok = await verifyPassword(password, String(user.password_salt), Number(user.password_iters), String(user.password_hash));
    if (!ok) {
      await sleep(150);
      return json({ ok: false, error: "Invalid credentials" }, 401, headers);
    }

    // 更新 last_login_at
    await env.DB.prepare(`
      UPDATE users SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?
    `).bind(user.id).run();

    const token = randomTokenUrlSafe(32);
    const days = 30;
    const expiresAt = isoAfterDays(days);

    await env.DB.prepare(`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(token, user.id, expiresAt).run();

    // 审计日志
    await writeAudit(env.DB, user.id, "LOGIN", user.id, { username });

    const resHeaders = new Headers({ ...headers, "Content-Type": "application/json; charset=utf-8" });
    resHeaders.append("Set-Cookie", buildSessionCookie(token, days));
    return new Response(JSON.stringify({
      ok: true,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }
    }), { status: 200, headers: resHeaders });

  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* ---------------- helpers ---------------- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function corsPreflight() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
async function safeJson(req) { try { return await req.json(); } catch { return null; } }
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function isoAfterDays(days) {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString();
}
function buildSessionCookie(token, days) {
  const maxAge = days * 24 * 60 * 60;
  // HttpOnly: 前端JS拿不到；SameSite=Lax：适合你这个站点；Secure：HTTPS下生效（Pages默认HTTPS）
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// ---- crypto: PBKDF2(SHA-256) ----
async function verifyPassword(password, saltB64, iters, expectedHashB64) {
  const salt = b64ToBytes(saltB64);
  const derived = await pbkdf2Sha256(password, salt, iters, 32);
  const gotB64 = bytesToB64(derived);
  return timingSafeEqualB64(gotB64, expectedHashB64);
}
async function pbkdf2Sha256(password, saltBytes, iterations, lengthBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    keyMaterial,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}
function randomTokenUrlSafe(nBytes) {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return bytesToBase64Url(a);
}
function bytesToBase64Url(bytes) {
  const b64 = bytesToB64(bytes);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}
function timingSafeEqualB64(a, b) {
  // 简易常量时间比较（避免明显时序差异）
  const aa = String(a), bb = String(b);
  let diff = aa.length ^ bb.length;
  const len = Math.max(aa.length, bb.length);
  for (let i=0;i<len;i++){
    diff |= (aa.charCodeAt(i) || 0) ^ (bb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function writeAudit(db, actorId, action, targetUserId, detailObj) {
  const detail = JSON.stringify(detailObj || {});
  await db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, target_user_id, detail)
    VALUES (?, ?, ?, ?)
  `).bind(actorId ?? null, action, targetUserId ?? null, detail).run();
}
