export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);

    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return json({ ok: false, error: "Invalid id" }, 400, headers);

    if (request.method === "GET") {
      const row = await env.DB.prepare(`
        SELECT id, name, class_name, lesson_date, topic, title, body, status, created_at
        FROM questions WHERE id = ?
      `).bind(id).first();

      if (!row) return json({ ok: false, error: "Not found" }, 404, headers);
      return json({ ok: true, item: row }, 200, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
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
