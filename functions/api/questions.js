export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);
      const offset = clampInt(url.searchParams.get("offset"), 0, 1000000, 0);

      // 带回答数
      const rows = await env.DB.prepare(`
        SELECT
          q.id, q.name, q.class_name, q.lesson_date, q.topic, q.title, q.body, q.status, q.created_at,
          (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) AS answer_count
        FROM questions q
        ORDER BY q.id DESC
        LIMIT ? OFFSET ?
      `).bind(limit, offset).all();

      return json({ ok: true, items: rows.results || [] }, 200, headers);
    }

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const name = str(body.name, 1, 50);
      const class_name = str(body.class_name, 0, 50);
      const lesson_date = body.lesson_date ? normalizeDate(body.lesson_date) : "";
      const topic = str(body.topic, 0, 100);
      const title = str(body.title, 1, 120);
      const qbody = str(body.body, 1, 2000);

      if (!name || !title || !qbody) {
        return json({ ok: false, error: "Missing required: name, title, body" }, 400, headers);
      }

      const ins = await env.DB.prepare(`
        INSERT INTO questions (name, class_name, lesson_date, topic, title, body)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        name,
        class_name || null,
        lesson_date || null,
        topic || null,
        title,
        qbody
      ).run();

      return json({ ok: true, id: ins.meta?.last_row_id }, 201, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* helpers */
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
function clampInt(v, min, max, def) {
  const n = parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
