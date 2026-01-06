export async function onRequestGet({ env }) {
  try {
    const db = env.DB || env.THREE_LINES_DB || env.three_lines_db;
    if (!db) {
      return json({ ok: false, error: "D1 binding not found (DB / THREE_LINES_DB / three_lines_db)" }, 500);
    }

    const cookies = parseCookies(env?.request?.headers?.get("Cookie") || "");
    const username = cookies.tl_user ? decodeURIComponent(cookies.tl_user) : null;

    if (!username) {
      return json({ ok: true, user: null });
    }

    const row = await db
      .prepare(
        `SELECT id, username, display_name, role
           FROM users
          WHERE username = ? AND is_active = 1
          LIMIT 1`
      )
      .bind(username)
      .first();

    if (!row) {
      // cookie 里有用户名但库里没有/被停用：清掉 cookie
      return json(
        { ok: true, user: null },
        200,
        {
          "Set-Cookie": makeCookie("tl_user", "", { maxAge: 0 })
        }
      );
    }

    return json({ ok: true, user: row });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
};

function parseCookies(cookieHeader) {
  const out = {};
  cookieHeader.split(";").forEach(part => {
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
  // HttpOnly：前端不需要读这个 cookie，只需要浏览器自动带上即可
  parts.push(`HttpOnly`);

  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}
