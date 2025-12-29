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
        SELECT name, hide_ranking, teacher_key, teacher_names
        FROM user_settings
        WHERE name = ?
      `).bind(name).first();

      // 兼容：没有记录时给默认值
      const item = row || {
        name,
        hide_ranking: 0,
        teacher_key: "",
        teacher_names: "[]",
      };

      return json({ ok: true, item }, 200, headers);
    }

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const name = str(body.name, 1, 50);
      if (!name) return json({ ok: false, error: "Missing: name" }, 400, headers);

      const hide = body.hide_ranking ? 1 : 0;

      // teacher_key: 允许为空（表示不启用校验），但你要“做得好”就填上
      const teacher_key = str(body.teacher_key, 0, 200);

      // teacher_names: 接受数组或字符串
      let teacher_names = "[]";
      if (Array.isArray(body.teacher_names)) {
        teacher_names = JSON.stringify(body.teacher_names.map(x => String(x)));
      } else if (body.teacher_names !== undefined && body.teacher_names !== null) {
        const s = String(body.teacher_names).trim();
        // 如果用户直接填 JSON 字符串，就原样存；否则也包成数组字符串
        teacher_names = s.startsWith("[") ? s : JSON.stringify([s]);
      }

      await env.DB.prepare(`
        INSERT INTO user_settings (name, hide_ranking, teacher_key, teacher_names)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          hide_ranking = excluded.hide_ranking,
          teacher_key = excluded.teacher_key,
          teacher_names = excluded.teacher_names
      `).bind(name, hide, teacher_key || null, teacher_names).run();

      return json({
        ok: true,
        item: { name, hide_ranking: hide, teacher_key: teacher_key || "", teacher_names }
      }, 200, headers);
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
    "Access-Control-Allow-Headers": "Content-Type, X-Teacher-Key",
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
