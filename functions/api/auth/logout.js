export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok:false, error:"DB binding missing" }, 500, headers);
    if (request.method !== "POST") return json({ ok:false, error:"Method Not Allowed" }, 405, headers);

    const token = readCookie(request.headers.get("Cookie") || "", "session");
    if (token) {
      await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    }

    const resHeaders = new Headers({ ...headers, "Content-Type":"application/json; charset=utf-8" });
    // 清cookie
    resHeaders.append("Set-Cookie", "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");

    return new Response(JSON.stringify({ ok:true }), { status:200, headers:resHeaders });
  } catch (e) {
    return json({ ok:false, error:String(e?.message||e) }, 500, headers);
  }
}

function corsHeaders(){
  return {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
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
