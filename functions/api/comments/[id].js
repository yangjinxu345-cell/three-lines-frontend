export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    const commentId = parseInt(params.id ?? "", 10);
    if (!Number.isFinite(commentId) || commentId <= 0) {
      return json({ ok: false, error: "Invalid comment id" }, 400, headers);
    }

    await requireTeacherKey(env.DB, request);

    const existing = await env.DB.prepare(`
      SELECT id, post_id, teacher_name, body, created_at, updated_at, is_deleted
      FROM post_comments
      WHERE id = ?
    `).bind(commentId).first();

    if (!existing) return json({ ok: false, error: "Comment not found" }, 404, headers);

    if (request.method === "PUT") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const teacherName = str(body.teacher_name, 1, 50);
      const newBody = str(body.body, 1, 2000);
      if (!teacherName || !newBody) {
        return json({ ok: false, error: "Missing fields: teacher_name, body" }, 400, headers);
      }
      if (teacherName !== existing.teacher_name) {
        return json({ ok: false, error: "Forbidden: not your comment" }, 403, headers);
      }

      await env.DB.prepare(`
        UPDATE post_comments
        SET body = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        WHERE id = ? AND is_deleted = 0
      `).bind(newBody, commentId).run();

      return json({ ok: true }, 200, headers);
    }

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const teacherName = str(url.searchParams.get("teacher_name"), 1, 50);
      if (!teacherName) return json({ ok: false, error: "Missing teacher_name" }, 400, headers);
      if (teacherName !== existing.teacher_name) {
        return json({ ok: false, error: "Forbidden: not your comment" }, 403, headers);
      }

      await env.DB.prepare(`
        UPDATE post_comments
        SET is_deleted = 1, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        WHERE id = ?
      `).bind(commentId).run();

      const postId = existing.post_id;

      const agg = await env.DB.prepare(`
        SELECT COUNT(*) AS c, MAX(created_at) AS lastAt
        FROM post_comments
        WHERE post_id = ? AND is_deleted = 0
      `).bind(postId).first();

      const c = Number(agg?.c ?? 0);
      const lastAt = agg?.lastAt ?? null;

      await env.DB.prepare(`
        UPDATE posts SET comment_count = ?, last_commented_at = ? WHERE id = ?
      `).bind(c, lastAt, postId).run();

      return json({ ok: true, comment_count: c, last_commented_at: lastAt }, 200, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.startsWith("AUTH:")) {
      return json({ ok: false, error: msg.replace(/^AUTH:\s*/, "") }, 401, headers);
    }
    return json({ ok: false, error: msg }, 500, headers);
  }
}

async function requireTeacherKey(db, request) {
  const provided = (request.headers.get("X-Teacher-Key") || "").trim();
  if (!provided) throw new Error("AUTH: Missing X-Teacher-Key");

  const row = await db.prepare(`
    SELECT teacher_key FROM user_settings WHERE name = 'default'
  `).first();

  const expected = String(row?.teacher_key || "").trim();
  if (expected && provided !== expected) {
    throw new Error("AUTH: Invalid teacher key");
  }
}

/* helpers */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,DELETE",
    "Access-Control-Allow-Headers": "Content-Type, X-Teacher-Key",
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
