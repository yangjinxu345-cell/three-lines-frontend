// functions/api/auth/logout.js

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map((v) => v.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return "";
}

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const sessionToken = getCookie(request, "session_token");

  try {
    if (sessionToken) {
      await env.DB.prepare(`DELETE FROM sessions WHERE session_token = ?`).bind(sessionToken).run();
    }

    // 清掉正确的 cookie 名：session_token（并且 Path 必须是 /）
    const cookie = `session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": cookie,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
