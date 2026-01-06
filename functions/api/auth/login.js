// functions/api/auth/login.js

function json(headers, status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateSessionToken() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function createSession(db, userId) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30天

  await db
    .prepare(
      `INSERT INTO sessions (session_token, user_id, expires_at)
       VALUES (?, ?, ?)`
    )
    .bind(token, userId, expiresAt)
    .run();

  return { token, expiresAt };
}

function makeSessionCookie(token, maxAgeSeconds = 30 * 24 * 60 * 60) {
  return [
    `session_token=${encodeURIComponent(token)}`,
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ].join("; ");
}

// 运行时探测 users 表里的密码字段名
async function detectPasswordColumn(db) {
  const rs = await db.prepare(`PRAGMA table_info(users)`).all();
  const cols = (rs?.results || []).map((r) => String(r.name || "").toLowerCase());

  const candidates = [
    "password",
    "passwd",
    "pass",
    "password_hash",
    "pass_hash",
    "hash",
    "pwd",
    "pw",
  ];

  for (const c of candidates) {
    if (cols.includes(c)) return c;
  }
  return null;
}

async function validateCredentials(db, username, password) {
  // 找密码列
  const pwCol = await detectPasswordColumn(db);
  if (!pwCol) {
    // 没找到密码列，直接失败（避免误登录）
    return null;
  }

  // 查用户
  const row = await db
    .prepare(
      `SELECT id, username, display_name, role, ${pwCol} AS pw
       FROM users
       WHERE username = ?
       LIMIT 1`
    )
    .bind(username)
    .first();

  if (!row) return null;

  const stored = row.pw == null ? "" : String(row.pw);

  // 兼容：明文 or sha256(hex)
  const input = String(password);
  const inputSha = await sha256Hex(input);

  const ok =
    stored === input || // 明文
    stored.toLowerCase() === inputSha.toLowerCase(); // sha256 hex

  if (!ok) return null;

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
  };
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
    return json(headers, 405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = await request.json();
    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username || !password) {
      return json(headers, 400, { ok: false, error: "用户名或密码为空" });
    }

    const user = await validateCredentials(env.DB, username, password);
    if (!user) {
      return json(headers, 401, { ok: false, error: "用户名或密码错误" });
    }

    const session = await createSession(env.DB, user.id);
    const setCookie = makeSessionCookie(session.token);

    return new Response(
      JSON.stringify({ ok: true, user }),
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
    return json(headers, 500, { ok: false, error: e?.message || String(e) });
  }
}
