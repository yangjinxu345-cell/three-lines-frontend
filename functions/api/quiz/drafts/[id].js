// functions/api/quiz/drafts/[id].js
export async function onRequest({ request, env, params }) {
  const headers = corsHeaders();
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);
    if (!isTeacherOrAdmin(me)) return json({ ok: false, error: "Forbidden (teacher/admin only)" }, 403, headers);

    const id = parseInt(String(params.id || ""), 10);
    if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "Invalid id" }, 400, headers);

    if (request.method === "GET") {
      const row = await env.DB.prepare(
        `SELECT
           d.*,
           p.name AS post_name, p.class_name, p.lesson_date, p.topic,
           p.line1, p.line2, p.line3
         FROM quiz_drafts d
         LEFT JOIN posts p ON p.id = d.post_id
         WHERE d.id = ?
         LIMIT 1`
      ).bind(id).first();

      if (!row) return json({ ok: false, error: "Not found" }, 404, headers);
      return json({ ok: true, item: row }, 200, headers);
    }

    if (request.method === "PUT") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      // fields
      const question = str(body.question, 1, 500);
      const a = str(body.choice_a, 1, 200);
      const b = str(body.choice_b, 1, 200);
      const c = str(body.choice_c, 1, 200);
      const d = str(body.choice_d, 1, 200);
      const correct = String(body.correct_choice || "").trim().toUpperCase();
      const explanation = str(body.explanation, 0, 2000);
      const difficulty = clampInt(body.difficulty, 1, 3, 2);
      const status = String(body.status || "").trim();

      const review_note = str(body.review_note, 0, 500);

      if (!question || !a || !b || !c || !d) {
        return json({ ok: false, error: "question/choices are required" }, 400, headers);
      }
      if (!["A","B","C","D"].includes(correct)) {
        return json({ ok: false, error: "correct_choice must be A/B/C/D" }, 400, headers);
      }

      // status optional: allow only known values if provided
      const allowedStatus = new Set(["draft","reviewing","approved","rejected","published"]);
      if (status && !allowedStatus.has(status)) {
        return json({ ok: false, error: "Invalid status" }, 400, headers);
      }

      // update
      await env.DB.prepare(
        `UPDATE quiz_drafts
            SET question = ?,
                choice_a = ?, choice_b = ?, choice_c = ?, choice_d = ?,
                correct_choice = ?,
                explanation = ?,
                difficulty = ?,
                status = COALESCE(?, status),
                review_note = COALESCE(?, review_note),
                reviewed_by = CASE
                  WHEN ? IS NOT NULL AND ? != '' THEN ?
                  ELSE reviewed_by
                END,
                reviewed_at = CASE
                  WHEN ? IS NOT NULL AND ? != '' THEN datetime('now')
                  ELSE reviewed_at
                END,
                updated_at = datetime('now')
          WHERE id = ?`
      ).bind(
        question,
        a, b, c, d,
        correct,
        explanation || null,
        difficulty,
        status || null,
        review_note || null,
        status || null,
        status || "",
        me.id,
        status || null,
        status || "",
        id
      ).run();

      return json({ ok: true, id }, 200, headers);
    }

    return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* ---------------- helpers ---------------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}
async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
}
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
function clampInt(v, min, max, def) {
  const n = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function parseCookies(cookieHeader) {
  const out = {};
  const s = cookieHeader || "";
  s.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
async function getCurrentUser(env, request) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const username = (cookies.tl_user || "").trim();
  if (!username) return null;

  const row = await env.DB.prepare(
    `SELECT id, username, display_name, role
       FROM users
      WHERE username = ?
        AND is_active = 1
      LIMIT 1`
  ).bind(username).first();

  return row || null;
}
function isTeacherOrAdmin(me) {
  const role = String(me?.role || "");
  return role === "admin" || role === "teacher";
}
