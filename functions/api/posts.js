export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return corsPreflight();
  const headers = corsHeaders();

  try {
    if (!env.DB) return json({ ok: false, error: "DB binding missing (env.DB)" }, 500, headers);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const limit = clampInt(url.searchParams.get("limit"), 1, 50, 20);
      const offset = clampInt(url.searchParams.get("offset"), 0, 1000000, 0);

      const rows = await env.DB.prepare(`
        SELECT
          id, name, class_name, lesson_date, topic, line1, line2, line3, created_at,
          COALESCE(like_count, 0) AS like_count,
          COALESCE(comment_count, 0) AS comment_count,
          last_commented_at
        FROM posts
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `).bind(limit, offset).all();

      return json({ ok: true, items: rows.results || [] }, 200, headers);
    }

    if (request.method === "POST") {
      const body = await safeJson(request);
      if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, headers);

      const name = str(body.name, 1, 50);
      const class_name = str(body.class_name, 0, 50);
      const lesson_date = normalizeDate(body.lesson_date); // YYYY-MM-DD
      const topic = str(body.topic, 0, 100);

      // ★ 変更点：3行は「全部必須」→「どれか1行以上あればOK」
      const line1 = str(body.line1, 0, 200);
      const line2 = str(body.line2, 0, 200);
      const line3 = str(body.line3, 0, 200);

      const hasAnyLine = !!(line1 || line2 || line3);

      if (!name || !lesson_date || !hasAnyLine) {
        return json(
          { ok: false, error: "Missing required fields: name, lesson_date, and at least one of line1/line2/line3" },
          400,
          headers
        );
      }

      // 1) insert post（like/comment初期化してNULL回避）
      const ins = await env.DB.prepare(`
        INSERT INTO posts
          (name, class_name, lesson_date, topic, line1, line2, line3, like_count, comment_count, last_commented_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL)
      `).bind(
        name,
        class_name || null,
        lesson_date,
        topic || null,
        line1 || "",
        line2 || "",
        line3 || ""
      ).run();

      const postId = ins.meta?.last_row_id;

      // 2) auto create reminders: +1 day, +7 day
      const due1 = addDays(lesson_date, 1);
      const due7 = addDays(lesson_date, 7);

      await env.DB.prepare(`
        INSERT INTO reminders (name, related_post_id, due_date, label)
        VALUES (?, ?, ?, ?), (?, ?, ?, ?)
      `).bind(
        name, postId, due1, "翌日復習",
        name, postId, due7, "1週間復習"
      ).run();

      // 3) auto create quizzes: empty対策（空なら別の行を使う）
      const pick1 = firstNonEmpty(line1, line2, line3, "（内容なし）");
      const pick2a = firstNonEmpty(line2, line3, line1, "（内容なし）");
      const pick2b = firstNonEmpty(line3, line2, line1, "（内容なし）");

      const q1 = `【思い出し】今日のポイントを自分の言葉で説明して：${shorten(pick1, 60)}`;
      const q2 = `【思い出し】ポイント同士の関係を説明して：${shorten(pick2a, 60)} / ${shorten(pick2b, 60)}`;

      await env.DB.prepare(`
        INSERT INTO quizzes (name, related_post_id, due_date, question, type)
        VALUES (?, ?, ?, ?, 'free'), (?, ?, ?, ?, 'free')
      `).bind(
        name, postId, due1, q1,
        name, postId, due7, q2
      ).run();

      return json({ ok: true, id: postId, lesson_date }, 201, headers);
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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,DELETE",
    "Access-Control-Allow-Headers": "Content-Type, X-Teacher-Key",
  };
}
function corsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
async function safeJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
function str(v, minLen, maxLen) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (s.length < minLen) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
function normalizeDate(v) {
  const s = str(v, 8, 20);
  const m = s.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}
function addDays(yyyyMMdd, days) {
  const [y, m, d] = yyyyMMdd.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function clampInt(v, min, max, def) {
  const n = parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function shorten(s, n) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n) + "…" : t;
}
function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}
