export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, error: "Invalid JSON" }, 400);

    const {
      name,
      class_name,
      lesson_date,
      topic,
      line1,
      line2,
      line3,
    } = body;

    if (!name || !lesson_date || !line1 || !line2 || !line3) {
      return json({ ok: false, error: "Missing required fields: name, lesson_date, line1-3" }, 400);
    }

    const normalizedDate = normalizeDate(lesson_date);
    if (!normalizedDate) {
      return json({ ok: false, error: "lesson_date format should be YYYY-MM-DD or YYYY/MM/DD" }, 400);
    }

    const stmt = env.DB.prepare(
      `INSERT INTO posts (name, class_name, lesson_date, topic, line1, line2, line3)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      String(name).trim(),
      class_name ? String(class_name).trim() : null,
      normalizedDate,
      topic ? String(topic).trim() : null,
      String(line1).trim(),
      String(line2).trim(),
      String(line3).trim()
    );

    const result = await stmt.run();

    return json(
      { ok: true, id: result?.meta?.last_row_id ?? null, lesson_date: normalizedDate },
      201
    );
  } catch (err) {
    return json({ ok: false, error: err?.message || String(err) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
