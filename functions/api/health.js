export async function onRequest(context) {
  const { request, env } = context;

  // CORS
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    // 简单 DB 探活（可选）
    if (env.DB) {
      await env.DB.prepare("SELECT 1 as ok").first();
    }

    return json(
      {
        status: "ok",
        service: "three-lines-pages-api",
        time: new Date().toISOString(),
        db: !!env.DB,
      },
      200,
      headers
    );
  } catch (e) {
    return json(
      { status: "ng", error: String(e?.message || e), time: new Date().toISOString() },
      500,
      headers
    );
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
