export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500, headers);

    const url = new URL(request.url);

    if (request.method === "GET") {
      const name = (url.searchParams.get("name") || "").trim();
      if (!name) return json({ ok: false, error: "Missing ?name=" }, 400, headers);

      const row = await env.DB.prepare(`
        SELECT name, hide_ranking
        FROM user_settings
        WHERE name = ?
      `).bind(name).first();

      return json({ ok: true, item: row || { name, hide_ranking: 0 } }, 200, headers);
    }

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const name = str(body.name, 1, 50);
      const hide = body.hide_ranking ? 1 : 0;
      if (!name) return json({ ok: false, error: "Missing: name" }, 400, headers);

      await env.DB.prepare(`
        INSERT INTO user_settings (name, hide_ranking)
        VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET hide_ranking = excluded.hide_ranking
      `).bind(name, hide).run();

      return json({ ok: true, name, hide_ranking: hide }, 200, headers);
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
