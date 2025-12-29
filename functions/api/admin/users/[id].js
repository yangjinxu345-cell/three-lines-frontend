export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok:false, error:"DB binding missing" }, 500, headers);
    const me = await requireAdmin(env.DB, request);

    const userId = parseInt(params.id ?? "", 10);
    if (!Number.isFinite(userId) || userId <= 0) return json({ ok:false, error:"Invalid user id" }, 400, headers);

    if (request.method !== "PUT") return json({ ok:false, error:"Method Not Allowed" }, 405, headers);

    const body = await safeJson(request);
    if (!body) return json({ ok:false, error:"Invalid JSON body" }, 400, headers);

    const display_name = str(body.display_name, 1, 80);
    const role = str(body.role, 1, 20);
    const is_active = body.is_active ? 1 : 0;

    if (!display_name || !["student","teacher","admin"].includes(role)) {
      return json({ ok:false, error:"Missing/Invalid fields: display_name, role" }, 400, headers);
    }

    await env.DB.prepare(`
      UPDATE users
      SET display_name = ?, role = ?, is_active = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?
    `).bind(display_name, role, is_active, userId).run();

    await writeAudit(env.DB, me.id, "USER_UPDATE", userId, { display_name, role, is_active });

    return json({ ok:true }, 200, headers);

  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.startsWith("AUTH:")) return json({ ok:false, error: msg.replace(/^AUTH:\s*/, "") }, 401, headers);
    return json({ ok:false, error: msg }, 500, headers);
  }
}

/* helpers */
function corsHeaders(){ return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"PUT,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}; }
function corsPreflight(){ return new Response(null,{status:204, headers:corsHeaders()}); }
function json(obj,status=200,headers={}){ return new Response(JSON.stringify(obj),{status,headers:{ "Content-Type":"application/json; charset=utf-8", ...headers}}); }
async function safeJson(req){ try{return await req.json();}catch{return null;} }
function str(v,min,max){ if(v==null) return ""; const s=String(v).trim(); if(s.length<min) return ""; return s.length>max?s.slice(0,max):s; }
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
  return { id: row.id };
}
async function writeAudit(db, actorId, action, targetUserId, detailObj){
  await db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, target_user_id, detail)
    VALUES (?, ?, ?, ?)
  `).bind(actorId ?? null, action, targetUserId ?? null, JSON.stringify(detailObj||{})).run();
}
