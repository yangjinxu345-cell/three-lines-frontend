export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB || env.THREE_LINES_DB || env.three_lines_db;
    if (!db) return json({ ok: false, error: "D1 binding not found" }, 500);

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return json({ ok: false, error: "username/password required" }, 400);
    }

    // 兼容不同表结构：先尝试带 password 字段的查询；失败则退化为不查 password（仅用于你现在调通流程）
    let row = null;

    try {
      row = await db
        .prepare(
          `SELECT id, username, display_name, role, password, is_active
             FROM users
            WHERE username = ?
            LIMIT 1`
        )
        .bind(username)
        .first();

      if (!row) return json({ ok: false, error: "invalid credentials" }, 401);
      if (row.is_active === 0) return json({ ok: false, error: "user disabled" }, 403);

      // 如果表里有 password 字段，就做明文对比（你如果将来改成哈希，再在这里替换逻辑）
      if (row.password !== undefined && row.password !== password) {
        return json({ ok: false, error: "invalid credentials" }, 401);
      }
    } catch (e) {
      // 退化：不依赖 password 字段（只用于先跑通 cookie/login 流程）
      row = await db
        .prepare(
          `SELECT id, username, display_name, role, is_active
             FROM users
            WHERE username = ?
            LIMIT 1`
        )
        .bind(username)
        .first();

      if (!row) return json({ ok: false, error: "invalid credentials" }, 401);
      if (row.is_active === 0) return json({ ok: false, error: "user disabled" }, 403);
      // 注意：这里无法校验密码（因为你表结构不明），只是为了先把“cookie读写链路”跑通
    }

    // ✅ 写入登录 cookie：tl_user
    const cookieVal = encodeURIComponent(row.username);
    const headers = new Headers({
      "Set-Cookie": makeCookie("tl_user", cookieVal, { maxAge: 60 * 60 * 24 * 7 }), // 7天
    });

    return json({ ok: true, user: pickUser(row) }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

function pickUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
  };
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
