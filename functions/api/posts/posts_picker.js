// functions/api/posts/posts_picker.js
export async function onRequest({ request }) {
  // 只允许 GET/OPTIONS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
  }

  // 返回纯 JS
  return new Response(JS_CODE, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// 这里是脚本内容（与之前的 posts_picker.js 一样）
const JS_CODE = `
async function api(path, opt = {}) {
  const res = await fetch(path, { credentials: "include", cache: "no-store", ...opt });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error("HTTP " + res.status + " " + text);
  if (data && typeof data === "object" && data.ok === false) throw new Error(data.error || "API error");
  return data;
}
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

let OFFSET = 0;
const LIMIT = 20;
let TOTAL = 0;
let ITEMS = [];

function setErr(msg){
  const el = document.getElementById("err");
  if (!el) return;
  el.style.display = msg ? "" : "none";
  el.textContent = msg || "";
}
function updatePage(){
  const pageEl = document.getElementById("page");
  const prev = document.getElementById("prev");
  const next = document.getElementById("next");
  if (!pageEl || !prev || !next) return;

  const from = Math.min(OFFSET + 1, TOTAL);
  const to = Math.min(OFFSET + LIMIT, TOTAL);
  pageEl.textContent = \`\${from}-\${to} / \${TOTAL}\`;
  prev.disabled = OFFSET <= 0;
  next.disabled = OFFSET + LIMIT >= TOTAL;
}

function render(){
  const list = document.getElementById("list");
  if (!list) return;
  list.innerHTML = "";

  for(const p of ITEMS){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = \`
      <div class="row1">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="badge">#\${p.id}</span>
          <span class="badge">\${esc(p.lesson_date||"-")}</span>
          <span class="badge">\${esc(p.class_name||"-")}</span>
          <span class="badge">\${esc(p.topic||"-")}</span>
        </div>
        <div class="name">\${esc(p.name||"-")}</div>
      </div>

      <div class="lines">
        <div>1) \${esc(p.line1||"")}</div>
        <div>2) \${esc(p.line2||"")}</div>
        <div>3) \${esc(p.line3||"")}</div>
      </div>

      <div class="actions">
        <button class="btn primary" data-id="\${p.id}">この投稿を使う</button>
      </div>
    \`;
    list.appendChild(div);
  }

  list.querySelectorAll("button[data-id]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = Number(btn.getAttribute("data-id"));
      const post = ITEMS.find(x => Number(x.id) === id);
      if (!post) return;

      const payload = {
        type: "postSelected",
        post: {
          id: post.id,
          name: post.name,
          class_name: post.class_name,
          lesson_date: post.lesson_date,
          topic: post.topic,
          line1: post.line1, line2: post.line2, line3: post.line3
        }
      };

      // opener に送る
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, location.origin);
        }
      } catch {}

      // localStorage 兜底
      try {
        localStorage.setItem("tl_selected_post", JSON.stringify(payload.post));
      } catch {}

      // 閉じる（ブロック時は戻る）
      try { window.close(); } catch {}
      location.href = "/quiz_admin.html";
    });
  });
}

async function load(){
  setErr("");
  const qEl = document.getElementById("q");
  const q = qEl ? qEl.value.trim() : "";

  const url = new URL(location.origin + "/api/posts");
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("offset", String(OFFSET));
  if (q) url.searchParams.set("q", q);

  const r = await api(url.pathname + "?" + url.searchParams.toString());
  ITEMS = r.items || [];
  TOTAL = r.total || 0;

  render();
  updatePage();
}

document.getElementById("reload")?.addEventListener("click", ()=>{
  OFFSET = 0;
  load().catch(e=>setErr(String(e.message||e)));
});
document.getElementById("prev")?.addEventListener("click", ()=>{
  OFFSET = Math.max(0, OFFSET - LIMIT);
  load().catch(e=>setErr(String(e.message||e)));
});
document.getElementById("next")?.addEventListener("click", ()=>{
  OFFSET = OFFSET + LIMIT;
  load().catch(e=>setErr(String(e.message||e)));
});

let t=null;
document.getElementById("q")?.addEventListener("input", ()=>{
  clearTimeout(t);
  t=setTimeout(()=>{
    OFFSET=0;
    load().catch(e=>setErr(String(e.message||e)));
  }, 200);
});

load().catch(e=>setErr(String(e.message||e)));
`;
