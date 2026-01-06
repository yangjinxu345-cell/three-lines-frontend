// functions/api/auth/login.js
import { validateCredentials, createSession, makeSessionCookie } from "../../_lib/auth.js";

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

  try {
    const body = await request.json();
    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username || !password) {
      return new Response(JSON.stringify({ ok: false, error: "用户名或密码为空" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const user = await validateCredentials(env.DB, username, password);
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "用户名或密码错误" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const sessionToken = await createSession(env.DB, user.id);
    const setCookie = makeSessionCookie(sessionToken);

    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          role: user.role,
        },
      }),
      {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": setCookie,
        },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
