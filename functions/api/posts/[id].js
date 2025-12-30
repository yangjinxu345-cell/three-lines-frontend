export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    const id = parseInt(params.id ?? "", 10);
    if (!Number.isFinite(id) || id <= 0) {
      return json({ ok: false, error: "Invalid id" }, 400, headers);
    }

    // 登录用户
    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);

    if (request.method === "GET") {
      const row = await env.DB.prepare(`
        SELECT id, name, class_name, lesson_date, topic, line1, line2, line3, created_at,
               COALESCE(like_count,0) AS like_count,
               COALESCE(comment_count,0) AS comment_count,
               last_commented_at
        FROM posts
        WHERE id = ?
      `).bind(id).first();

      if (!row) return json({ ok: false, error: "Not found" }, 404, headers);

      const canEdit = (me.role === "admin") || (String(row.name || "") === String(me.display_name || ""));
      return json({ ok: true, item: row, can_edit: canEdit }, 200, headers);
    }

    if (request.method === "PUT") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const row = await env.DB.prepare(`SELECT id, name FROM posts WHERE id=?`).bind(id).first();
      if (!row) return json({ ok: false, error: "Not found" }, 404, headers);

      const isOwner = String(row.name || "") === String(me.display_name || "");
      const canEdit = (me.role === "admin") || isOwner;
      if (!canEdit) return json({ ok: false, error: "Forbidden" }, 403, headers);

      const class_name = str(body.class_name, 0, 50);
      const lesson_date = normalizeDate(body.lesson_date);
      const topic = str(body.topic, 0, 100);

      // 3行：至少1行非空即可
      const line1 = str(body.line1, 0, 200);
      const line2 = str(body.line2, 0, 200);
      const line3 = str(body.line3, 0, 200);
      if (!lesson_date) return json({ ok: false, error: "Missing lesson_date" }, 400, headers);
      if (!(line1 || line2 || line3)) {
        return json({ ok: false, error: "At least one of line1/line2/line3 is required" }, 400, headers);
      }

      await env.DB.prepare(`
        UPDATE posts
        SET class_name = ?,
            lesson_date = ?,
            topic = ?,
            line1 = ?,
            line2 = ?,
            line3 = ?
        WHERE id = ?
      `).bind(
        class_name || null,
        lesson_date,
        topic || null,
        line1 || "",
        line2 || "",
        line3 || "",
        id
      ).run();

      return json({ ok: true, id }, 200, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* ---------------- helpers ---------------- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
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
async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
}
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
function normalizeDate(v) {
  const s = str(v, 8, 20);
  const m = s.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
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

// 假设你登录后把 session token 存在 Cookie: session=xxxxx
async function getCurrentUser(env, request) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.session || cookies.token || cookies.session_token || "";
  if (!token) return null;

  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
      AND (s.expires_at IS NULL OR s.expires_at > (strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      AND u.is_active = 1
  `).bind(token).first();

  return row || null;
}
