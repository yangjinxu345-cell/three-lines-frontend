// functions/api/auth/logout.js

function json(headers, status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function clearCookie() {
  return [
    `session_token=`,
    `Path=/`,
    `Max-Age=0`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ].join("; ");
}

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json(headers, 405, { ok: false, error: "Method Not Allowed" });

  try {
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const token = cookies.session_token || "";

    if (token) {
      await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": clearCookie(),
      },
    });
  } catch (e) {
    return json(headers, 500, { ok: false, error: e?.message || String(e) });
  }
}
