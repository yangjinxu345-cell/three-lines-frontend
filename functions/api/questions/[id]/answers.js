export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);

    const qid = parseInt(params.id, 10);
    if (!Number.isFinite(qid)) return json({ ok: false, error: "Invalid question id" }, 400, headers);

    if (request.method === "GET") {
      const rows = await env.DB.prepare(`
        SELECT id, question_id, name, body, created_at
        FROM answers
        WHERE question_id = ?
        ORDER BY id ASC
      `).bind(qid).all();

      return json({ ok: true, items: rows.results || [] }, 200, headers);
    }

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const name = str(body.name, 1, 50);
      const abody = str(body.body, 1, 2000);
      if (!name || !abody) return json({ ok: false, error: "Missing: name, body" }, 400, headers);

      const ins = await env.DB.prepare(`
        INSERT INTO answers (question_id, name, body)
        VALUES (?, ?, ?)
      `).bind(qid, name, abody).run();

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
