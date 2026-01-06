export async function onRequestPost() {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  // ✅ 清掉所有可能残留的 cookie
  headers.append("Set-Cookie", "tl_user=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  headers.append("Set-Cookie", "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  headers.append("Set-Cookie", "session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function onRequestGet() {
  return new Response("Method Not Allowed", { status: 405 });
}
