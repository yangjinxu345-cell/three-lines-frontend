export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok:false, error:"DB binding missing" }, 500, headers);
    if (request.method !== "POST") return json({ ok:false, error:"Method Not Allowed" }, 405, headers);

    const me = await requireLogin(env.DB, request);
    const body = await safeJson(request);
    if (!body) return json({ ok:false, error:"Invalid JSON body" }, 400, headers);

    const oldPassword = str(body.old_password, 1, 200);
    const newPassword = str(body.new_password, 8, 200);
    if (!oldPassword || !newPassword) return json({ ok:false, error:"Missing old/new password" }, 400, headers);
    if (!isStrongEnough(newPassword)) return json({ ok:false, error:"Password too weak" }, 400, headers);

    const user = await env.DB.prepare(`
      SELECT id, password_hash, password_salt, password_iters
      FROM users WHERE id = ?
    `).bind(me.id).first();

    const ok = await verifyPassword(oldPassword, String(user.password_salt), Number(user.password_iters), String(user.password_hash));
    if (!ok) return json({ ok:false, error:"Old password incorrect" }, 401, headers);

    const iters = 210000;
    const salt = randomBytes(16);
    const hash = await pbkdf2Sha256(newPassword, salt, iters, 32);

    await env.DB.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iters = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?
    `).bind(bytesToB64(hash), bytesToB64(salt), iters, me.id).run();

    await writeAudit(env.DB, me.id, "PASSWORD_CHANGE_SELF", me.id, {});
    return json({ ok:true }, 200, headers);

  } catch (e) {
    const msg = String(e?.message||e);
    if (msg.startsWith("AUTH:")) return json({ ok:false, error: msg.replace(/^AUTH:\s*/, "") }, 401, headers);
    return json({ ok:false, error: msg }, 500, headers);
  }
}

/* helpers */
function corsHeaders(){ return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}; }
function corsPreflight(){ return new Response(null,{status:204, headers:corsHeaders()}); }
function json(obj,status=200,headers={}){ return new Response(JSON.stringify(obj),{status,headers:{ "Content-Type":"application/json; charset=utf-8", ...headers}}); }
async function safeJson(req){ try{return await req.json();}catch{return null;} }
function str(v,min,max){ if(v==null) return ""; const s=String(v).trim(); if(s.length<min) return ""; return s.length>max?s.slice(0,max):s; }
function readCookie(cookieHeader, name){
  const parts=cookieHeader.split(/;\s*/);
  for(const p of parts){ const i=p.indexOf("="); if(i<0) continue; if(p.slice(0,i).trim()===name) return p.slice(i+1).trim(); }
  return "";
}
async function requireLogin(db, request){
  const token = readCookie(request.headers.get("Cookie")||"", "session");
  if(!token) throw new Error("AUTH: Not logged in");
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT s.expires_at, u.id, u.username, u.display_name, u.role, u.is_active
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? LIMIT 1
  `).bind(token).first();
  if(!row) throw new Error("AUTH: Not logged in");
  if(Number(row.is_active)!==1) throw new Error("AUTH: Account disabled");
  if(String(row.expires_at) <= now) {
    await db.prepare(`DELETE FROM sessions WHERE token=?`).bind(token).run();
    throw new Error("AUTH: Session expired");
  }
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
}
function isStrongEnough(pw){
  // 至少8位 + 字母 + 数字
  if(pw.length < 8) return false;
  if(!/[A-Za-z]/.test(pw)) return false;
  if(!/[0-9]/.test(pw)) return false;
  return true;
}
function randomBytes(n){ const a=new Uint8Array(n); crypto.getRandomValues(a); return a; }
async function pbkdf2Sha256(password, saltBytes, iterations, lengthBytes){
  const enc=new TextEncoder();
  const keyMaterial=await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:saltBytes, iterations}, keyMaterial, lengthBytes*8);
  return new Uint8Array(bits);
}
function bytesToB64(bytes){ let bin=""; for(const b of bytes) bin+=String.fromCharCode(b); return btoa(bin); }
function b64ToBytes(b64){ const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
async function verifyPassword(password, saltB64, iters, expectedHashB64){
  const salt=b64ToBytes(saltB64);
  const derived=await pbkdf2Sha256(password, salt, iters, 32);
  const got=bytesToB64(derived);
  return timingSafeEqualB64(got, expectedHashB64);
}
function timingSafeEqualB64(a,b){
  const aa=String(a), bb=String(b);
  let diff=aa.length ^ bb.length;
  const len=Math.max(aa.length, bb.length);
  for(let i=0;i<len;i++) diff |= (aa.charCodeAt(i)||0) ^ (bb.charCodeAt(i)||0);
  return diff===0;
}
async function writeAudit(db, actorId, action, targetUserId, detailObj){
  await db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, target_user_id, detail)
    VALUES (?, ?, ?, ?)
  `).bind(actorId ?? null, action, targetUserId ?? null, JSON.stringify(detailObj||{})).run();
}
