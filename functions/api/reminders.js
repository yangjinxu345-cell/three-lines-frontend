export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const name = (url.searchParams.get("name") || "").trim();
      const due = (url.searchParams.get("due") || "today").trim(); // today / all / yyyy-mm-dd
      const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);

      let dueDate = "";
      if (due === "today") dueDate = todayUTC();
      else if (/^\d{4}-\d{2}-\d{2}$/.test(due)) dueDate = due;

      // 简化：只取未完成 done=0
      let sql = `
        SELECT id, name, related_post_id, due_date, label, done, done_at, created_at
        FROM reminders
        WHERE done = 0
      `;
      const binds = [];

      if (name) {
        sql += ` AND name = ?`;
        binds.push(name);
      }
      if (dueDate) {
        sql += ` AND due_date <= ?`; // 到期(含以前)
        binds.push(dueDate);
      }

      sql += ` ORDER BY due_date ASC, id ASC LIMIT ?`;
      binds.push(limit);

      const rows = await env.DB.prepare(sql).bind(...binds).all();
      return json({ ok: true, due: dueDate || "all", items: rows.results || [] }, 200, headers);
    }

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const name = str(body.name, 1, 50);
      const related_post_id = body.related_post_id ? parseInt(body.related_post_id, 10) : null;
      const due_date = normalizeDate(body.due_date);
      const label = str(body.label, 1, 50);

      if (!name || !due_date || !label) {
        return json({ ok: false, error: "Missing: name, due_date, label" }, 400, headers);
      }

      const ins = await env.DB.prepare(`
        INSERT INTO reminders (name, related_post_id, due_date, label)
        VALUES (?, ?, ?, ?)
      `).bind(name, related_post_id, due_date, label).run();

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
function todayUTC() {
  const dt = new Date();
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function clampInt(v, min, max, def) {
  const n = parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
