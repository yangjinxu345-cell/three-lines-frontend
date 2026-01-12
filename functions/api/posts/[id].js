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

    // ✅ 登录用户（tl_user）
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

      const canEdit =
        (me.role === "admin") ||
        (String(row.name || "") === String(me.display_name || "")) ||
        (String(row.name || "").replace(/\s+/g,"") === String(me.display_name || "").replace(/\s+/g,"")) ||
        (String(row.name || "").replace(/\s+/g,"") === String(me.username || "").replace(/\s+/g,""));

      return json({ ok: true, item: row, can_edit: canEdit }, 200, headers);
    }

    if (request.method === "PUT") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const row = await env.DB.prepare(`SELECT id, name FROM posts WHERE id=?`).bind(id).first();
      if (!row) return json({ ok: false, error: "Not found" }, 404, headers);

      const isOwner =
        String(row.name || "") === String(me.display_name || "") ||
        String(row.name || "").replace(/\s+/g,"") === String(me.display_name || "").replace(/\s+/g,"") ||
        String(row.name || "").replace(/\s+/g,"") === String(me.username || "").replace(/\s+/g,"");

      const canEdit = (me.role === "admin") || isOwner;
      if (!canEdit) return json({ ok: false, error: "Forbidden" }, 403, headers);

      const class_name = str(body.class_name, 0, 50);
      const lesson_date = normalizeDate(body.lesson_date);
      const topic = str(body.topic, 0, 100);

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

// ✅ tl_user から users を引く
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
