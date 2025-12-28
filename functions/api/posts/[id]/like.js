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

    // 要求教員キー存在（先不校验值，后面你把 settings.js 给我我再做“真实校验”）
    const teacherKey = request.headers.get("X-Teacher-Key") || "";
    if (!teacherKey.trim()) return json({ ok: false, error: "Missing X-Teacher-Key" }, 401, headers);

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const teacherName = str(body.teacher_name, 1, 50);
      if (!teacherName) return json({ ok: false, error: "Missing teacher_name" }, 400, headers);

      let liked = true;
      try {
        await env.DB.prepare(`
          INSERT INTO post_likes (post_id, teacher_name)
          VALUES (?, ?)
        `).bind(postId, teacherName).run();
      } catch (e) {
        // UNIQUE(post_id, teacher_name) 冲突：已经点过赞了
        const msg = String(e?.message || e);
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          liked = false;
        } else {
          throw e;
        }
      }

      const likeCount = await recomputeLikeCount(env.DB, postId);
      return json({ ok: true, liked, like_count: likeCount }, 200, headers);
    }

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const teacherName = str(url.searchParams.get("teacher_name"), 1, 50);
      if (!teacherName) return json({ ok: false, error: "Missing teacher_name" }, 400, headers);

      await env.DB.prepare(`
        DELETE FROM post_likes
        WHERE post_id = ? AND teacher_name = ?
      `).bind(postId, teacherName).run();

      const likeCount = await recomputeLikeCount(env.DB, postId);
      return json({ ok: true, like_count: likeCount }, 200, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

async function recomputeLikeCount(db, postId) {
  const r = await db.prepare(`
    SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?
  `).bind(postId).first();

  const c = Number(r?.c ?? 0);

  await db.prepare(`
    UPDATE posts SET like_count = ? WHERE id = ?
  `).bind(c, postId).run();

  return c;
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
