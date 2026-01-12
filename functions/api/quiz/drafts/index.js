// functions/api/quiz/drafts/index.js
export async function onRequestGet({ request, env }) {
  const headers = corsHeaders();
  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);
    if (!isTeacherOrAdmin(me)) return json({ ok: false, error: "Forbidden (teacher/admin only)" }, 403, headers);

    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || "").trim();   // draft/reviewing/approved/rejected/published
    const q = (url.searchParams.get("q") || "").trim();
    const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);
    const offset = clampInt(url.searchParams.get("offset"), 0, 1000000, 0);

    const where = [];
    const bind = [];

    if (status) {
      where.push("d.status = ?");
      bind.push(status);
    }
    if (q) {
      where.push("(d.question LIKE ? OR d.choice_a LIKE ? OR d.choice_b LIKE ? OR d.choice_c LIKE ? OR d.choice_d LIKE ? OR p.topic LIKE ? OR p.name LIKE ?)");
      const like = `%${q}%`;
      bind.push(like, like, like, like, like, like, like);
    }

    const whereSql = where.length ? ("WHERE " + where.join(" AND ")) : "";

    // total
    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c
         FROM quiz_drafts d
         LEFT JOIN posts p ON p.id = d.post_id
        ${whereSql}`
    ).bind(...bind).first();

    const total = Number(totalRow?.c || 0);

    // list
    const rows = await env.DB.prepare(
      `SELECT
          d.id, d.post_id, d.status, d.question,
          d.correct_choice, d.difficulty,
          d.created_at, d.updated_at, d.reviewed_at,
          d.created_by, d.reviewed_by,
          p.name AS post_name, p.class_name, p.lesson_date, p.topic
        FROM quiz_drafts d
        LEFT JOIN posts p ON p.id = d.post_id
        ${whereSql}
        ORDER BY d.id DESC
        LIMIT ? OFFSET ?`
    ).bind(...bind, limit, offset).all();

    return json({
      ok: true,
      items: rows.results || [],
      total,
      limit,
      offset
    }, 200, headers);

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
function isTeacherOrAdmin(me) {
  const role = String(me?.role || "");
  return role === "admin" || role === "teacher";
}
