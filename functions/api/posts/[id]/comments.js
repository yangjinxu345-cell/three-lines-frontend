export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    const postId = parseInt(params.id ?? "", 10);
    if (!Number.isFinite(postId) || postId <= 0) {
      return json({ ok: false, error: "Invalid post id" }, 400, headers);
    }

    if (request.method === "GET") {
      const rows = await env.DB.prepare(`
        SELECT id, post_id, teacher_name, body, created_at, updated_at
        FROM post_comments
        WHERE post_id = ? AND is_deleted = 0
        ORDER BY created_at ASC, id ASC
      `).bind(postId).all();

      return json({ ok: true, items: rows.results || [] }, 200, headers);
    }

    if (request.method === "POST") {
      const me = await getCurrentUser(env, request);
      if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);

      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const userName = String(me.display_name || me.username || "").trim() || "unknown";
      const commentBody = str(body.body, 1, 2000);
      if (!commentBody) {
        return json({ ok: false, error: "Missing body" }, 400, headers);
      }

      const ins = await env.DB.prepare(`
        INSERT INTO post_comments (post_id, teacher_name, body)
        VALUES (?, ?, ?)
      `).bind(postId, userName, commentBody).run();

      const commentId = ins.meta?.last_row_id;

      const { count, lastAt } = await recomputeCommentAgg(env.DB, postId);

      return json({
        ok: true,
        id: commentId,
        comment_count: count,
        last_commented_at: lastAt
      }, 201, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

async function recomputeCommentAgg(db, postId) {
  const r = await db.prepare(`
    SELECT COUNT(*) AS c, MAX(created_at) AS lastAt
    FROM post_comments
    WHERE post_id = ? AND is_deleted = 0
  `).bind(postId).first();

  const c = Number(r?.c ?? 0);
  const lastAt = r?.lastAt ?? null;

  await db.prepare(`
    UPDATE posts
    SET comment_count = ?, last_commented_at = ?
    WHERE id = ?
  `).bind(c, lastAt, postId).run();

  return { count: c, lastAt };
}

/* helpers */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
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
async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
}
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
function parseCookies(cookieHeader) {
  const out = {};
  const s = cookieHeader || "";
  s.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
async function getCurrentUser(env, request) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const username = (cookies.tl_user || "").trim();
  if (!username) return null;

  const row = await env.DB.prepare(`
    SELECT id, username, display_name, role
    FROM users
    WHERE username = ?
      AND is_active = 1
    LIMIT 1
  `).bind(username).first();

  return row || null;
}
