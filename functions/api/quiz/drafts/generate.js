// functions/api/quiz/drafts/generate.js
// POST /api/quiz/drafts/generate
// body: { post_ids: [1,2,3], model?: "@cf/meta/llama-3.1-8b-instruct" }
// requires login (tl_user cookie) + admin/teacher role

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct"; // Workers AI model page exists in docs

export async function onRequestPost({ request, env }) {
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);
    if (!env.AI) return json({ ok: false, error: "AI binding missing (env.AI). Bind Workers AI as 'AI' in Pages." }, 500, headers);

    // 1) auth
    const me = await getCurrentUser(env, request);
    if (!me) return json({ ok: false, error: "Not logged in" }, 401, headers);
    if (!isTeacherOrAdmin(me)) return json({ ok: false, error: "Forbidden (teacher/admin only)" }, 403, headers);

    // 2) input
    const body = await safeJson(request);
    const postIds = Array.isArray(body?.post_ids) ? body.post_ids : [];
    const model = String(body?.model || DEFAULT_MODEL);

    if (postIds.length === 0) {
      return json({ ok: false, error: "post_ids is required" }, 400, headers);
    }
    // 防止一次生成太多导致超时/超额
    if (postIds.length > 10) {
      return json({ ok: false, error: "Too many post_ids (max 10 per request)" }, 400, headers);
    }

    // 3) fetch posts
    const posts = [];
    for (const raw of postIds) {
      const id = parseInt(String(raw), 10);
      if (!Number.isFinite(id) || id <= 0) continue;

      const row = await env.DB.prepare(
        `SELECT id, name, class_name, lesson_date, topic, line1, line2, line3
           FROM posts
          WHERE id = ?
          LIMIT 1`
      ).bind(id).first();

      if (row) posts.push(row);
    }

    if (posts.length === 0) {
      return json({ ok: false, error: "No valid posts found" }, 404, headers);
    }

    // 4) generate draft per post
    const results = [];
    const errors = [];

    for (const p of posts) {
      try {
        const prompt = buildPromptForSingleChoice(p);

        const aiResp = await env.AI.run(model, {
          messages: [
            { role: "system", content: "You are a strict JSON generator. Output ONLY valid JSON. No markdown." },
            { role: "user", content: prompt }
          ],
          // 适度限制输出，降低 neurons 消耗
          max_tokens: 500,
          temperature: 0.4
        });

        // Workers AI LLM responses vary by model; normalize
        const rawText = normalizeAiText(aiResp);
        const parsed = parseStrictQuizJson(rawText);

        const validated = validateQuizObject(parsed);

        // Insert quiz_drafts
        const ins = await env.DB.prepare(
          `INSERT INTO quiz_drafts
            (post_id, ai_provider, ai_model, ai_prompt, ai_raw_json,
             question, choice_a, choice_b, choice_c, choice_d,
             correct_choice, explanation, difficulty,
             status, created_by, created_at, updated_at)
           VALUES
            (?, 'cloudflare_workers_ai', ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?,
             'draft', ?, datetime('now'), datetime('now'))`
        ).bind(
          p.id,
          model,
          prompt,
          rawText,
          validated.question,
          validated.choices[0],
          validated.choices[1],
          validated.choices[2],
          validated.choices[3],
          indexToChoice(validated.answer_index),
          validated.explanation || null,
          validated.difficulty || 2,
          me.id
        ).run();

        results.push({
          post_id: p.id,
          draft_id: ins.meta?.last_row_id ?? null
        });
      } catch (e) {
        errors.push({
          post_id: p.id,
          error: String(e?.message || e)
        });
      }
    }

    return json({ ok: true, created: results, errors }, 200, headers);
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
    "Cache-Control": "no-store"
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

function isTeacherOrAdmin(me) {
  const role = String(me?.role || "");
  return role === "admin" || role === "teacher";
}

function buildPromptForSingleChoice(p) {
  // 控制长度，避免 neurons 浪费
  const topic = (p.topic || "").slice(0, 120);
  const l1 = (p.line1 || "").slice(0, 220);
  const l2 = (p.line2 || "").slice(0, 220);
  const l3 = (p.line3 || "").slice(0, 220);

  return [
    "次の授業メモ（3行投稿）に基づいて、日本語の「思い出しクイズ」（4択・単一選択）を1問作ってください。",
    "",
    "【投稿情報】",
    `授業名/テーマ: ${topic}`,
    `1行目: ${l1}`,
    `2行目: ${l2}`,
    `3行目: ${l3}`,
    "",
    "【出力ルール】",
    "必ず JSON のみを返してください。余計な文章、説明、Markdown は禁止です。",
    "JSON形式:",
    '{',
    '  "question": "問題文（日本語、1文〜2文）",',
    '  "choices": ["選択肢A","選択肢B","選択肢C","選択肢D"],',
    '  "answer_index": 0,',
    '  "explanation": "解説（1〜3文）",',
    '  "difficulty": 2',
    '}',
    "",
    "制約:",
    "- answer_index は 0〜3 の整数。",
    "- choices は必ず4つ、内容は重複しない。",
    "- 投稿内容から逸脱しない（推測で専門用語を増やさない）。",
    "- 重要語句・定義・因果関係など「復習」に適した問いにする。"
  ].join("\n");
}

function normalizeAiText(aiResp) {
  // Workers AI の返り値はモデルにより揺れることがあるため吸収
  if (aiResp == null) return "";
  if (typeof aiResp === "string") return aiResp;

  // よくある: { response: "..." }
  if (typeof aiResp.response === "string") return aiResp.response;

  // Chat形式: { choices: [ { message: { content: "..." } } ] }
  const c0 = aiResp.choices?.[0];
  const content = c0?.message?.content;
  if (typeof content === "string") return content;

  // fallback
  return JSON.stringify(aiResp);
}

function parseStrictQuizJson(text) {
  const s = String(text || "").trim();

  // 1) 直接 JSON ならそのまま
  try { return JSON.parse(s); } catch {}

  // 2) 文章に紛れた JSON を抽出（最初の { から最後の }）
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    return JSON.parse(candidate);
  }
  throw new Error("AI output is not valid JSON");
}

function validateQuizObject(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Quiz JSON must be an object");

  const question = String(obj.question || "").trim();
  if (!question) throw new Error("Missing question");

  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length !== 4) throw new Error("choices must be an array of 4 strings");

  const cleaned = choices.map(x => String(x || "").trim());
  if (cleaned.some(x => !x)) throw new Error("choices contains empty option");
  const set = new Set(cleaned);
  if (set.size !== 4) throw new Error("choices must be unique");

  const answerIndex = Number(obj.answer_index);
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) throw new Error("answer_index must be integer 0..3");

  const explanation = String(obj.explanation || "").trim();
  const difficulty = obj.difficulty == null ? 2 : Number(obj.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) throw new Error("difficulty must be 1..3");

  return {
    question,
    choices: cleaned,
    answer_index: answerIndex,
    explanation,
    difficulty
  };
}

function indexToChoice(i) {
  return ["A","B","C","D"][i] || "A";
}
