export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // CORS（你现在同域其实不必须，但加上不吃亏）
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (request.method === "OPTIONS") {
    return new Response("", { headers: corsHeaders });
  }

  // ===== GET /api/posts 取列表 =====
  if (request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

    const rs = await env.DB.prepare(
      `SELECT id, name, class_name, lesson_date, topic, line1, line2, line3, created_at
       FROM posts
       ORDER BY id DESC
       LIMIT ?`
    ).bind(limit).all();

    return new Response(JSON.stringify({ ok: true, items: rs.results }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }

  // ===== POST /api/posts 写入 =====
  if (request.method === "POST") {
    const body = await request.json();

    const name = body.name ?? "";
    const class_name = body.class_name ?? "";
    const lesson_date = body.lesson_date ?? "";
    const topic = body.topic ?? "";
    const line1 = body.line1 ?? "";
    const line2 = body.line2 ?? "";
    const line3 = body.line3 ?? "";

    if (!name || !lesson_date || !line1 || !line2 || !line3) {
      return new Response(JSON.stringify({ ok: false, error: "missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }

    const result = await env.DB.prepare(
      `INSERT INTO posts (name, class_name, lesson_date, topic, line1, line2, line3)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(name, class_name, lesson_date, topic, line1, line2, line3).run();

    return new Response(JSON.stringify({ ok: true, id: result.meta.last_row_id, lesson_date }), {
      status: 201,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}
