export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok:false, error:"DB binding missing" }, 500, headers);

    const me = await requireAdmin(env.DB, request);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const q = (url.searchParams.get("q") || "").trim();
      const role = (url.searchParams.get("role") || "").trim();
      const limit = clampInt(url.searchParams.get("limit"), 1, 200, 100);

      let where = `1=1`;
      const binds = [];

      if (q) {
        where += ` AND (username LIKE ? OR display_name LIKE ?)`;
        binds.push(`%${q}%`, `%${q}%`);
      }
      if (role && ["student","teacher","admin"].includes(role)) {
        where += ` AND role = ?`;
        binds.push(role);
      }

      const sql = `
        SELECT id, username, display_name, role, is_active, created_at, updated_at
        FROM users
        WHERE ${where}
        ORDER BY id ASC
        LIMIT ?
      `;
      binds.push(limit);

      const rows = await env.DB.prepare(sql).bind(...binds).all();
      return json({ ok:true, items: rows.results || [] }, 200, headers);
    }

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok:false, error:"Invalid JSON body" }, 400, headers);

      const username = str(body.username, 3, 80);
      const display_name = str(body.display_name, 1, 80);
      const role = str(body.role, 1, 20);
      const password = str(body.password, 8, 200);

      if (!username || !display_name || !["student","teacher","admin"].includes(role)) {
        return json({ ok:false, error:"Missing/Invalid fields: username, display_name, role" }, 400, headers);
      }
      if (!password || !isStrongEnough(password)) {
        return json({ ok:false, error:"Password too weak (>=8, letters+digits)" }, 400, headers);
      }

      const iters = 210000;
      const salt = randomBytes(16);
      const hash = await pbkdf2Sha256(password, salt, iters, 32);

      const ins = await env.DB.prepare(`
        INSERT INTO users (username, display_name, role, password_hash, password_salt, password_iters, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).bind(username, display_name, role, bytesToB64(hash), bytesToB64(salt), iters).run();

      const newId = ins.meta?.last_row_id;

      await writeAudit(env.DB, me.id, "USER_CREATE", newId, { username, role, display_name });

      return json({ ok:true, id:newId }, 201, headers);
    }

    return json({ ok:false, error:"Method Not Allowed" }, 405, headers);

  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.startsWith("AUTH:")) return json({ ok:false, error: msg.replace(/^AUTH:\s*/, "") }, 401, headers);
    return json({ ok:false, error: msg }, 500, headers);
  }
}

/* helpers */
function corsHeaders(){
  return {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
  };
}
function corsPreflight(){ return new Response(null,{status:204, headers:corsHeaders()}); }
function json(obj,status=200,headers={}){ return new Response(JSON.stringify(obj),{status,headers:{ "Content-Type":"application/json; charset=utf-8", ...headers}}); }
async function safeJson(req){ try{return await req.json();}catch{return null;} }
function str(v,min,max){ if(v==null) return ""; const s=String(v).trim(); if(s.length<min) return ""; return s.length>max?s.slice(0,max):s; }
function clampInt(v,min,max,def){ const n=parseInt(v??"",10); if(Number.isNaN(n)) return def; return Math.max(min, Math.min(max,n)); }

function readCookie(cookieHeader, name){
  const parts=cookieHeader.split(/;\s*/);
  for(const p of parts){ const i=p.indexOf("="); if(i<0) continue; if(p.slice(0,i).trim()===name) return p.slice(i+1).trim(); }
  return "";
}
async function requireAdmin(db, request){
  const token = readCookie(request.headers.get("Cookie")||"", "session");
  if(!token) throw new Error("AUTH: Not logged in");
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT s.expires_at, u.id, u.role, u.is_active
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? LIMIT 1
  `).bind(token).first();

  if(!row) throw new Error("AUTH: Not logged in");
  if(Number(row.is_active)!==1) throw new Error("AUTH: Account disabled");
  if(String(row.expires_at) <= now) throw new Error("AUTH: Session expired");
  if(String(row.role) !== "admin") throw new Error("AUTH: Admin only");
  return { id: row.id, role: row.role };
}

function isStrongEnough(pw){
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

async function writeAudit(db, actorId, action, targetUserId, detailObj){
  await db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, target_user_id, detail)
    VALUES (?, ?, ?, ?)
  `).bind(actorId ?? null, action, targetUserId ?? null, JSON.stringify(detailObj||{})).run();
}
