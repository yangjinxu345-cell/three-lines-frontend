// functions/api/auth/me.js

function json(headers, status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "GET") return json(headers, 405, { ok: false, error: "Method Not Allowed" });

  try {
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const token = cookies.session_token || "";
    if (!token) return json(headers, 200, { ok: true, user: null });

    const row = await env.DB.prepare(`
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.role,
        u.is_active,
        s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      LIMIT 1
    `).bind(token).first();

    if (!row) return json(headers, 200, { ok: true, user: null });
    if (row.is_active === 0) return json(headers, 200, { ok: true, user: null });

    // 过期判断（expires_at 是 ISO 字符串）
    const exp = row.expires_at ? Date.parse(String(row.expires_at)) : NaN;
    if (!Number.isNaN(exp) && exp <= Date.now()) {
      await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
      return json(headers, 200, { ok: true, user: null });
    }

    return json(headers, 200, {
      ok: true,
      user: {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
      },
    });
  } catch (e) {
    return json(headers, 500, { ok: false, error: e?.message || String(e) });
  }
}
