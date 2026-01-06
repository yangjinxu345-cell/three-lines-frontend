export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": [
        makeCookie("tl_user", "", { maxAge: 0 })
      ].join(", ")
    }
  });
}

export async function onRequestGet() {
  return new Response("Method Not Allowed", { status: 405 });
}

function makeCookie(name, value, opts = {}) {
  const parts = [];
  parts.push(`${name}=${value}`);
  parts.push(`Path=/`);
  parts.push(`SameSite=Lax`);
  parts.push(`Secure`);
  parts.push(`HttpOnly`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}
