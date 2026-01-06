export async function onRequestGet({ request, env }) {
  try {
    const db = env.DB || env.THREE_LINES_DB || env.three_lines_db;
    if (!db) return json({ ok: false, error: "D1 binding not found" }, 500);

    const cookieHeader = request.headers.get("Cookie") || "";
    const cookies = parseCookies(cookieHeader);
    const username = cookies.tl_user ? decodeURIComponent(cookies.tl_user) : null;

    if (!username) {
      return json({ ok: true, user: null });
    }

    const row = await db
      .prepare(
        `SELECT id, username, display_name, role, is_active
           FROM users
          WHERE username = ?
          LIMIT 1`
      )
      .bind(username)
      .first();

    if (!row || row.is_active === 0) {
      // 用户不存在/被禁用：清 cookie
      const headers = new Headers({
        "Set-Cookie": makeCookie("tl_user", "", { maxAge: 0 }),
      });
      return json({ ok: true, user: null }, 200, headers);
    }

    return json({
      ok: true,
      user: {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  cookieHeader.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

function makeCookie(name, value, opts = {}) {
  const parts = [];
  parts.push(`${name}=${value}`);
  parts.push(`Path=/`);
  parts.push(`SameSite=Lax`);
  parts.push(`Secure`);
  parts.push(`HttpOnly`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

function json(obj, status = 200, extraHeaders) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (extraHeaders) {
    for (const [k, v] of extraHeaders.entries()) headers.append(k, v);
  }
  return new Response(JSON.stringify(obj), { status, headers });
}
