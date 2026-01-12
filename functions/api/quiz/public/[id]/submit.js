// functions/api/quiz/public/[id]/submit.js
export async function onRequest({ request, env, params }) {
  const headers = corsHeaders();
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);

    const id = parseInt(String(params.id || ""), 10);
    if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "Invalid id" }, 400, headers);

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method Not Allowed" }, 405, headers);
    }

    const body = await safeJson(request);
    if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

    // 兼容前端多种提交方式：
    // A) { answers: { "12": ["A"] } }
    // B) { answers: { "12": "A" } }
    // C) { selected_choice: "A" }
    // D) { answer: "A" }
    let selected = "";

    if (body.answers && typeof body.answers === "object") {
      // 优先取 key=id 的答案
      const v1 = body.answers[String(id)];
      if (v1 !== undefined) {
        selected = Array.isArray(v1) ? String(v1[0] ?? "") : String(v1 ?? "");
      } else {
        // 其次随便取第一个（单题模式）
        const keys = Object.keys(body.answers);
        if (keys.length > 0) {
          const v = body.answers[keys[0]];
          selected = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
        }
      }
    }
    if (!selected) selected = String(body.selected_choice ?? body.answer ?? "").trim();

    selected = String(selected || "").trim().toUpperCase();
    if (!["A", "B", "C", "D"].includes(selected)) {
      return json({ ok: false, error: "selected_choice must be A/B/C/D" }, 400, headers);
    }

    // 读取正确答案
    const item = await env.DB.prepare(
      `SELECT id, correct_choice
         FROM quiz_items
        WHERE id = ?
          AND is_active = 1
        LIMIT 1`
    ).bind(id).first();

    if (!item) return json({ ok: false, error: "Not found" }, 404, headers);

    const isCorrect = (String(item.correct_choice || "").toUpperCase() === selected) ? 1 : 0;

    // 1) 创建 attempt（单题，所以 total_questions=1）
    const attemptRun = await env.DB.prepare(
      `INSERT INTO quiz_attempts
        (user_id, mode, class_name, lesson_date, total_questions, correct_count, score_percent, started_at, finished_at)
       VALUES
        (?, 'manual', NULL, NULL, 1, 0, 0, datetime('now'), NULL)`
    ).bind(me.id).run();

    const attemptId = attemptRun?.meta?.last_row_id;
    if (!attemptId) {
      return json({ ok: false, error: "Failed to create attempt" }, 500, headers);
    }

    // 2) 插入答案明细
    await env.DB.prepare(
      `INSERT INTO quiz_attempt_answers
        (attempt_id, quiz_item_id, selected_choice, is_correct, answered_at)
       VALUES
        (?, ?, ?, ?, datetime('now'))`
    ).bind(attemptId, id, selected, isCorrect).run();

    // 3) 更新 attempt 汇总
    const correctCount = isCorrect ? 1 : 0;
    const scorePercent = isCorrect ? 100 : 0;

    await env.DB.prepare(
      `UPDATE quiz_attempts
          SET total_questions = 1,
              correct_count = ?,
              score_percent = ?,
              finished_at = datetime('now')
        WHERE id = ?`
    ).bind(correctCount, scorePercent, attemptId).run();

    // 返回给前端
    return json({
      ok: true,
      attempt_id: attemptId,
      score: correctCount,
      total: 1,
      score_percent: scorePercent,
      detail: [
        { qid: String(id), quiz_item_id: id, selected_choice: selected, correct: !!isCorrect }
      ]
    }, 200, headers);

  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/* ---------------- helpers ---------------- */
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
async function safeJson(req) {
  try { return await req.json(); } catch { return null; }
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
