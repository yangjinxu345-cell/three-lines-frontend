export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);
    if (request.method !== "GET") return json({ ok: false, error: "Method Not Allowed" }, 405, headers);

    const url = new URL(request.url);
    const limit = clampInt(url.searchParams.get("limit"), 1, 50, 10);

    // 投稿数
    const posts = await env.DB.prepare(`
      SELECT name, COUNT(*) AS post_count
      FROM posts
      GROUP BY name
      ORDER BY post_count DESC, name ASC
      LIMIT ?
    `).bind(limit).all();

    // 回答数
    const answers = await env.DB.prepare(`
      SELECT name, COUNT(*) AS answer_count
      FROM answers
      GROUP BY name
      ORDER BY answer_count DESC, name ASC
      LIMIT ?
    `).bind(limit).all();

    return json(
      { ok: true, posts: posts.results || [], answers: answers.results || [] },
      200,
      headers
    );
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
function clampInt(v, min, max, def) {
  const n = parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
