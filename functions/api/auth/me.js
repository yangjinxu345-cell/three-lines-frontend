export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok:false, error:"DB binding missing" }, 500, headers);
    if (request.method !== "GET") return json({ ok:false, error:"Method Not Allowed" }, 405, headers);

    const token = readCookie(request.headers.get("Cookie") || "", "session");
    if (!token) return json({ ok:true, user:null }, 200, headers);

    const now = new Date().toISOString();

    const row = await env.DB.prepare(`
      SELECT s.token, s.expires_at,
             u.id, u.username, u.display_name, u.role, u.is_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `).bind(token).first();

    if (!row) return json({ ok:true, user:null }, 200, headers);
    if (Number(row.is_active) !== 1) return json({ ok:true, user:null }, 200, headers);
    if (String(row.expires_at) <= now) {
      await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
      return json({ ok:true, user:null }, 200, headers);
    }

    return json({ ok:true, user:{
      id: row.id, username: row.username, display_name: row.display_name, role: row.role
    }}, 200, headers);

  } catch (e) {
    return json({ ok:false, error:String(e?.message||e) }, 500, headers);
  }
}

function corsHeaders(){
  return {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
  };
}
function corsPreflight(){ return new Response(null,{status:204, headers:corsHeaders()}); }
function json(obj,status=200,headers={}){
  return new Response(JSON.stringify(obj),{status,headers:{ "Content-Type":"application/json; charset=utf-8", ...headers}});
}
function readCookie(cookieHeader, name){
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts){
    const i = p.indexOf("=");
    if (i<0) continue;
    const k = p.slice(0,i).trim();
    const v = p.slice(i+1).trim();
    if (k === name) return v;
  }
  return "";
}
