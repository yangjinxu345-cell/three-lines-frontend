export async function onRequestGet(context) {
  return new Response(JSON.stringify({
    status: "ok",
    service: "three-lines-pages-api",
    time: new Date().toISOString(),
  }, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
