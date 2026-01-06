// functions/api/auth/me.js

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map((v) => v.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return "";
}

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const sessionToken = getCookie(request, "session_token");
  if (!sessionToken) {
    return new Response(JSON.stringify({ ok: true, user: null }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // 这里假设你的 DB 结构是：
  // sessions(session_token, user_id, expires_at)
  // users(id, username, display_name, role)
  // expires_at 如果是 ISO 字符串，可直接与 datetime('now') 比较
  const sql = `
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.session_token = ?
      AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
    LIMIT 1
  `;

  try {
    const row = await env.DB.prepare(sql).bind(sessionToken).first();
    return new Response(JSON.stringify({ ok: true, user: row || null }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
