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
  const parts = cookieHeader.split(";");
  for (const part of parts) {
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

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "GET") {
    return json(headers, 405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const cookieHeader = request.headers.get("Cookie") || "";
    const cookies = parseCookies(cookieHeader);
    const token = cookies.session_token || "";

    if (!token) {
      return json(headers, 200, { ok: true, user: null });
    }

    // sessions 里查 token，并确认未过期，然后 join users
    const row = await env.DB.prepare(
      `
      SELECT
        u.id AS id,
        u.username AS username,
        u.display_name AS display_name,
        u.role AS role,
        s.expires_at AS expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token = ?
      LIMIT 1
      `
    )
      .bind(token)
      .first();

    if (!row) {
      return json(headers, 200, { ok: true, user: null });
    }

    // 过期判断（expires_at 是 ISO 字符串时适用）
    const exp = row.expires_at ? Date.parse(String(row.expires_at)) : NaN;
    if (!Number.isNaN(exp) && exp <= Date.now()) {
      // 过期：删掉这条 session（可选但推荐）
      await env.DB.prepare(`DELETE FROM sessions WHERE session_token = ?`)
        .bind(token)
        .run();
      return json(headers, 200, { ok: true, user: null });
    }

    const user = {
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      role: row.role,
    };

    return json(headers, 200, { ok: true, user });
  } catch (e) {
    return json(headers, 500, { ok: false, error: e?.message || String(e) });
  }
}
