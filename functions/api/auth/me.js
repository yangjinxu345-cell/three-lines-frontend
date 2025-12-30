export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);
    if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, 405, headers);

    // ✅ 修复：login/logout 都用的是 cookie 名 "session"
    const token = readCookie(request.headers.get("Cookie") || "", "session");
    if (!token) return json({ ok: true, user: null }, 200, headers);

    const row = await env.DB.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).bind(token).first();

    if (!row) return json({ ok: true, user: null }, 200, headers);

    // expire check
    if (String(row.expires_at) <= new Date().toISOString()) {
      await env.DB.prepare(`DELETE FROM sessions WHERE token=?`).bind(token).run();
      return json({ ok: true, user: null }, 200, headers);
    }

    return json({
      ok: true,
      user: { id: row.id, username: row.username, display_name: row.display_name, role: row.role }
    }, 200, headers);

  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

function readCookie(cookie, key) {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
}
function corsPreflight() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
