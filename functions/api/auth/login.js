export async function onRequestPost({ request, env }) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  // 读取 cookie（兼容：session / session_token）
  const cookieHeader = request.headers.get("Cookie") || "";
  const token = readCookie(cookieHeader, "session") || readCookie(cookieHeader, "session_token");

  // 1) 删除 sessions 表里的记录（如果 token 不存在也无所谓）
  if (token) {
    try {
      await env.DB.prepare("DELETE FROM sessions WHERE token = ?")
        .bind(token)
        .run();
    } catch (e) {
      // 忽略 DB 删除失败，仍然继续清 cookie
      console.warn("logout: failed to delete session", e);
    }
  }

  // 2) 清 cookie（两种名字都清掉，避免残留导致切换用户失败）
  headers.append("Set-Cookie", "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  headers.append("Set-Cookie", "session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function readCookie(cookieHeader, name) {
  const parts = cookieHeader.split(";").map((s) => s.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}
