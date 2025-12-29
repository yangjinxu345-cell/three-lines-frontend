export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);
    if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, 405, headers);

    const token = readCookie(request.headers.get("Cookie") || "", "session");
    if (!token) return json({ ok: false, error: "Not logged in" }, 401, headers);

    const sess = await env.DB.prepare(`
      SELECT token, user_id, expires_at
      FROM sessions
      WHERE token = ?
    `).bind(token).first();

    if (!sess) return json({ ok: false, error: "Not logged in" }, 401, headers);

    const nowIso = new Date().toISOString();
    if (String(sess.expires_at) <= nowIso) {
      try { await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run(); } catch {}
      return json({ ok: false, error: "Session expired" }, 401, headers);
    }

    const user = await env.DB.prepare(`
      SELECT id, username, display_name, role
      FROM users
      WHERE id = ?
    `).bind(sess.user_id).first();

    if (!user) return json({ ok: false, error: "Not logged in" }, 401, headers);

    return json({ ok: true, user }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

function readCookie(cookieHeader, key) {
  const parts = cookieHeader.split(";").map(s => s.trim());
  for (const p of parts) {
    if (p.startsWith(key + "=")) return decodeURIComponent(p.slice(key.length + 1));
  }
  return "";
}

/* helpers */
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
