// functions/api/quiz/public/index.js
export async function onRequestGet({ request, env }) {
  const headers = corsHeaders();
  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    // 学生侧也建议要求登录（attempt 需要 user_id）
    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const difficulty = clampInt(url.searchParams.get("difficulty"), 1, 3, 0); // 0 means ignore
    const topic = (url.searchParams.get("topic") || "").trim();
    const class_name = (url.searchParams.get("class_name") || "").trim();
    const lesson_date = (url.searchParams.get("lesson_date") || "").trim();
    const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);
    const offset = clampInt(url.searchParams.get("offset"), 0, 1000000, 0);

    const where = ["qi.is_active = 1"];
    const bind = [];

    if (difficulty) {
      where.push("qi.difficulty = ?");
      bind.push(difficulty);
    }
    if (topic) {
      where.push("COALESCE(qi.topic,'') = ?");
      bind.push(topic);
    }
    if (class_name) {
      where.push("COALESCE(qi.class_name,'') = ?");
      bind.push(class_name);
    }
    if (lesson_date) {
      where.push("COALESCE(qi.lesson_date,'') = ?");
      bind.push(lesson_date);
    }
    if (q) {
      const like = `%${q}%`;
      where.push(
        "(qi.question LIKE ? OR qi.choice_a LIKE ? OR qi.choice_b LIKE ? OR qi.choice_c LIKE ? OR qi.choice_d LIKE ? OR COALESCE(qi.topic,'') LIKE ?)"
      );
      bind.push(like, like, like, like, like, like);
    }

    const whereSql = "WHERE " + where.join(" AND ");

    // total
    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c
         FROM quiz_items qi
        ${whereSql}`
    ).bind(...bind).first();

    const total = Number(totalRow?.c || 0);

    // list
    const rows = await env.DB.prepare(
      `SELECT
          qi.id,
          qi.question,
          qi.difficulty,
          qi.class_name,
          qi.lesson_date,
          qi.topic,
          qi.published_at,
          qi.updated_at
         FROM quiz_items qi
        ${whereSql}
        ORDER BY qi.published_at DESC, qi.id DESC
        LIMIT ? OFFSET ?`
    ).bind(...bind, limit, offset).all();

    // 为了让你之前的 quiz.html “不用改也能显示”，这里额外提供 title 字段
    const items = (rows.results || []).map(r => ({
      id: r.id,
      title: r.question,            // 兼容前端列表
      question: r.question,
      level: r.difficulty,          // 兼容你之前页面的 level 过滤
      difficulty: r.difficulty,
      class_name: r.class_name,
      lesson_date: r.lesson_date,
      topic: r.topic,
      published_at: r.published_at,
      updated_at: r.updated_at,
      question_count: 1             // 单题模式
    }));

    return json({ ok: true, items, total, limit, offset }, 200, headers);

  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/* ---------------- helpers ---------------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}
function clampInt(v, min, max, def) {
  const n = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
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

  const row = await env.DB.prepare(
    `SELECT id, username, display_name, role
       FROM users
      WHERE username = ?
        AND is_active = 1
      LIMIT 1`
  ).bind(username).first();

  return row || null;
}
