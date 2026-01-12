// functions/api/quiz/public/[id].js
export async function onRequest({ request, env, params }) {
  const headers = corsHeaders();
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);

    const id = parseInt(String(params.id || ""), 10);
    if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "Invalid id" }, 400, headers);

    if (request.method !== "GET") {
      return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
    }

    const row = await env.DB.prepare(
      `SELECT
         qi.id,
         qi.question,
         qi.choice_a, qi.choice_b, qi.choice_c, qi.choice_d,
         qi.explanation,
         qi.difficulty,
         qi.class_name,
         qi.lesson_date,
         qi.topic,
         qi.published_at,
         qi.updated_at
       FROM quiz_items qi
      WHERE qi.id = ?
        AND qi.is_active = 1
      LIMIT 1`
    ).bind(id).first();

    if (!row) return json({ ok: false, error: "Not found" }, 404, headers);

    // 为了配合你之前的 quiz_take.html（它期待 quiz.questions[]）
    // 这里返回一个“单题 quiz”
    const quiz = {
      id: row.id,
      title: row.question,
      level: row.difficulty,
      difficulty: row.difficulty,
      class_name: row.class_name,
      lesson_date: row.lesson_date,
      topic: row.topic,
      published_at: row.published_at,
      updated_at: row.updated_at,
      questions: [
        {
          qid: String(row.id),     // 用题目id当qid，方便 submit 对齐
          type: "single",
          text: row.question,
          choices: [
            { id: "A", text: row.choice_a },
            { id: "B", text: row.choice_b },
            { id: "C", text: row.choice_c },
            { id: "D", text: row.choice_d },
          ],
          explain: row.explanation || ""
          // 故意不下发 correct_choice（防作弊）
        }
      ]
    };

    return json({ ok: true, quiz }, 200, headers);

  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* ---------------- helpers ---------------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
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
