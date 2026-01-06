// functions/api/auth/login.js
import { validateCredentials } from "../../_lib/auth.js";

// 生成 session token（优先用 crypto.randomUUID）
function generateSessionToken() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  // 兜底：随机 32 bytes -> hex
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 写入 sessions 表（假设表名 sessions，字段 session_token / user_id / expires_at）
async function createSession(db, userId) {
  const token = generateSessionToken();

  // 30天过期（你想改更长/更短都可以）
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO sessions (session_token, user_id, expires_at)
       VALUES (?, ?, ?)`
    )
    .bind(token, userId, expiresAt)
    .run();

  return { token, expiresAt };
}

// 生成 Set-Cookie
function makeSessionCookie(token, maxAgeSeconds = 30 * 24 * 60 * 60) {
  // 注意：Path=/ 必须有，否则 logout / me 可能读不到
  return [
    `session_token=${encodeURIComponent(token)}`,
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
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

  // 预检请求
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

    // ✅ 用你现有 _lib/auth.js 的校验逻辑（不改你原来的密码机制）
    const user = await validateCredentials(env.DB, username, password);

    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "用户名或密码错误" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const session = await createSession(env.DB, user.id);
    const setCookie = makeSessionCookie(session.token);

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
