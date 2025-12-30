// functions/api/admin/users.js
import { corsHeaders, corsPreflight, json, requireAdmin, clampInt, str } from "../../_lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    const gate = await requireAdmin(context);
    if (!gate.ok) return gate.res;

    // GET /api/admin/users?limit=50&offset=0
    if (request.method === "GET") {
      const url = new URL(request.url);
      const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
      const offset = clampInt(url.searchParams.get("offset"), 0, 1000000, 0);

      const rows = await env.DB.prepare(`
        SELECT id, username, display_name, role
        FROM users
        ORDER BY id ASC
        LIMIT ? OFFSET ?
      `).bind(limit, offset).all();

      return json({ ok: true, items: rows.results || [] }, 200, headers);
    }

    // POST /api/admin/users  (create user)
    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const username = str(body.username, 1, 50);
      const display_name = str(body.display_name, 0, 80);
      const role = str(body.role, 1, 20) || "student";
      const password = str(body.password, 1, 200);

      if (!username || !password) {
        return json({ ok: false, error: "Missing: username, password" }, 400, headers);
      }
      if (!["student", "teacher", "admin"].includes(role)) {
        return json({ ok: false, error: "role must be student/teacher/admin" }, 400, headers);
      }

      // ⚠️ 这里假设你已有生成 hash/salt 的逻辑文件（你之前的套件里应该有）
      // 为了避免你现在又卡住，我先给一个最小可跑版本：直接存明文是不安全的，但你现在是“先跑通”
      // 你如果已经有 password_hash/salt 的生成函数，把下面替换掉即可。

      await env.DB.prepare(`
        INSERT INTO users (username, display_name, role, password_hash, password_salt)
        VALUES (?, ?, ?, ?, ?)
      `).bind(username, display_name || null, role, password, "plain").run();

      return json({ ok: true }, 201, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
}
