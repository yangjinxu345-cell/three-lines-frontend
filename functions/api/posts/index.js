// functions/api/posts/index.js
export async function onRequest({ request, env }) {
  const headers = corsHeaders();

  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    // 需要登录（投稿保存/查看都应该登录）
    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);

    if (request.method === "GET") {
      return handleGetList(request, env, headers);
    }

    if (request.method === "POST") {
      return handleCreate(request, env, me, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);

  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* ---------------- GET: list posts ---------------- */
async function handleGetList(request, env, headers) {
  const url = new URL(request.url);

  const q = (url.searchParams.get("q") || "").trim();
  const className = (url.searchParams.get("class_name") || "").trim();
  const lessonDate = (url.searchParams.get("lesson_date") || "").trim();
  const topic = (url.searchParams.get("topic") || "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);
  const offset = clampInt(url.searchParams.get("offset"), 0, 1000000, 0);

  const where = [];
  const bind = [];

  if (className) { where.push("p.class_name = ?"); bind.push(className); }
  if (lessonDate) { where.push("p.lesson_date = ?"); bind.push(lessonDate); }
  if (topic) { where.push("p.topic = ?"); bind.push(topic); }

  if (q) {
    const like = `%${q}%`;
    where.push(`(
      p.name LIKE ? OR
      p.topic LIKE ? OR
      p.line1 LIKE ? OR p.line2 LIKE ? OR p.line3 LIKE ?
    )`);
    bind.push(like, like, like, like, like);
  }

  const whereSql = where.length ? ("WHERE " + where.join(" AND ")) : "";

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c
       FROM posts p
       ${whereSql}`
  ).bind(...bind).first();

  const total = Number(totalRow?.c || 0);

  const rows = await env.DB.prepare(
    `SELECT
       p.id,
       p.name,
       p.class_name,
       p.lesson_date,
       p.topic,
       p.line1, p.line2, p.line3
     FROM posts p
     ${whereSql}
     ORDER BY p.lesson_date DESC, p.id DESC
     LIMIT ? OFFSET ?`
  ).bind(...bind, limit, offset).all();

  return json({ ok: true, items: rows.results || [], total, limit, offset }, 200, headers);
}

/* ---------------- POST: create a post ---------------- */
async function handleCreate(request, env, me, headers) {
  const body = await safeJson(request);
  if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

  // posts_new 页面通常会送这些字段（根据你 UI：授業名/テーマ + 3行）
  const topic = String(body.topic ?? body.lesson_name ?? "").trim();
  const line1 = String(body.line1 ?? "").trim();
  const line2 = String(body.line2 ?? "").trim();
  const line3 = String(body.line3 ?? "").trim();

  // 下面两个字段如果前端没有传，就给默认值，避免插入失败
  const class_name = String(body.class_name ?? "").trim() || (me.class_name ?? ""); // 没有就空
  const lesson_date = String(body.lesson_date ?? "").trim() || todayYmd();          // 默认今天

  if (!topic) return json({ ok: false, error: "topic is required" }, 400, headers);
  if (!line1 && !line2 && !line3) return json({ ok: false, error: "at least one line is required" }, 400, headers);

  // 你 posts 表里有 name 字段：用当前登录人的 display_name
  const name = String(me.display_name ?? me.username ?? "").trim() || "unknown";

  // ⚠️ 假设 posts 表至少包含这些列（你 /api/posts 已经返回了这些列）
  const run = await env.DB.prepare(
    `INSERT INTO posts (name, class_name, lesson_date, topic, line1, line2, line3)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(name, class_name, lesson_date, topic, line1, line2, line3).run();

  const id = run?.meta?.last_row_id;

  return json({ ok: true, id }, 200, headers);
}

/* ---------------- helpers ---------------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
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
function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
