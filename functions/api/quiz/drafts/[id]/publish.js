// functions/api/quiz/drafts/[id]/publish.js
export async function onRequestPost({ request, env, params }) {
  const headers = corsHeaders();
  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);
    if (!isTeacherOrAdmin(me)) return json({ ok: false, error: "Forbidden (teacher/admin only)" }, 403, headers);

    const id = parseInt(String(params.id || ""), 10);
    if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "Invalid id" }, 400, headers);

    // load draft + post metadata
    const draft = await env.DB.prepare(
      `SELECT d.*,
              p.class_name AS post_class_name,
              p.lesson_date AS post_lesson_date,
              p.topic AS post_topic
         FROM quiz_drafts d
         LEFT JOIN posts p ON p.id = d.post_id
        WHERE d.id = ?
        LIMIT 1`
    ).bind(id).first();

    if (!draft) return json({ ok: false, error: "Not found" }, 404, headers);

    // basic validation
    if (!draft.question || !draft.choice_a || !draft.choice_b || !draft.choice_c || !draft.choice_d) {
      return json({ ok: false, error: "Draft is incomplete (question/choices required)" }, 400, headers);
    }
    if (!["A","B","C","D"].includes(String(draft.correct_choice || "").toUpperCase())) {
      return json({ ok: false, error: "Draft correct_choice invalid" }, 400, headers);
    }

    // insert quiz_items
    const ins = await env.DB.prepare(
      `INSERT INTO quiz_items
        (source_draft_id, post_id, is_active,
         question, choice_a, choice_b, choice_c, choice_d,
         correct_choice, explanation, difficulty,
         class_name, lesson_date, topic,
         published_by, published_at, updated_at)
       VALUES
        (?, ?, 1,
         ?, ?, ?, ?, ?,
         ?, ?, ?,
         ?, ?, ?,
         ?, datetime('now'), datetime('now'))`
    ).bind(
      draft.id,
      draft.post_id,
      draft.question,
      draft.choice_a, draft.choice_b, draft.choice_c, draft.choice_d,
      String(draft.correct_choice || "").toUpperCase(),
      draft.explanation || null,
      Number(draft.difficulty || 2),
      draft.post_class_name || null,
      draft.post_lesson_date || null,
      draft.post_topic || null,
      me.id
    ).run();

    const itemId = ins.meta?.last_row_id ?? null;

    // mark draft published
    await env.DB.prepare(
      `UPDATE quiz_drafts
          SET status = 'published',
              reviewed_by = ?,
              reviewed_at = COALESCE(reviewed_at, datetime('now')),
              updated_at = datetime('now')
        WHERE id = ?`
    ).bind(me.id, id).run();

    return json({ ok: true, draft_id: id, quiz_item_id: itemId }, 200, headers);

  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/* helpers */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
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
