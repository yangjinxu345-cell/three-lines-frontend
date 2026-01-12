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

    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);

    const userName = String(me.display_name || me.username || "").trim() || "unknown";

    if (request.method === "GET") {
      const r = await env.DB.prepare(`
        SELECT 1 AS ok
        FROM post_likes
        WHERE post_id = ? AND teacher_name = ?
        LIMIT 1
      `).bind(postId, userName).first();

      const likeCount = await recomputeLikeCount(env.DB, postId);
      return json({ ok: true, liked: !!r, like_count: likeCount }, 200, headers);
    }

    if (request.method === "POST") {
      let liked = true;
      try {
        await env.DB.prepare(`
          INSERT INTO post_likes (post_id, teacher_name)
          VALUES (?, ?)
        `).bind(postId, userName).run();
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          liked = false; // already liked
        } else {
          throw e;
        }
      }

      const likeCount = await recomputeLikeCount(env.DB, postId);
      return json({ ok: true, liked: (liked || false), like_count: likeCount }, 200, headers);
    }

    if (request.method === "DELETE") {
      await env.DB.prepare(`
        DELETE FROM post_likes
        WHERE post_id = ? AND teacher_name = ?
      `).bind(postId, userName).run();

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
