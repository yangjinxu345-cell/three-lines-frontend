// functions/api/auth/logout.js
import { corsHeaders, corsPreflight, json } from "../../_lib/auth.js";

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  // 删除 cookie：必须同名 + 同 Path
  const cookie = `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
    },
  });
}
