// /posts_picker.js
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
  el.style.display = msg ? "" : "none";
  el.textContent = msg || "";
}
function updatePage(){
  const from = Math.min(OFFSET + 1, TOTAL);
  const to = Math.min(OFFSET + LIMIT, TOTAL);
  document.getElementById("page").textContent = `${from}-${to} / ${TOTAL}`;
  document.getElementById("prev").disabled = OFFSET <= 0;
  document.getElementById("next").disabled = OFFSET + LIMIT >= TOTAL;
}

function render(){
  const list = document.getElementById("list");
  list.innerHTML = "";
  for(const p of ITEMS){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="row1">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="badge">#${p.id}</span>
          <span class="badge">${esc(p.lesson_date||"-")}</span>
          <span class="badge">${esc(p.class_name||"-")}</span>
          <span class="badge">${esc(p.topic||"-")}</span>
        </div>
        <div class="name">${esc(p.name||"-")}</div>
      </div>

      <div class="lines">
        <div>1) ${esc(p.line1||"")}</div>
        <div>2) ${esc(p.line2||"")}</div>
        <div>3) ${esc(p.line3||"")}</div>
      </div>

      <div class="actions">
        <button class="btn primary" data-id="${p.id}">この投稿を使う</button>
      </div>
    `;
    list.appendChild(div);
  }

  // bind buttons
  list.querySelectorAll("button[data-id]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = Number(btn.getAttribute("data-id"));
      const post = ITEMS.find(x => Number(x.id) === id);
      if (!post) return;

      // payload to send back
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

      // 1) try postMessage to opener
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, location.origin);
        }
      } catch {}

      // 2) localStorage fallback
      try {
        localStorage.setItem("tl_selected_post", JSON.stringify(payload.post));
      } catch {}

      // close window
      try { window.close(); } catch {}
      // if blocked, redirect back
      location.href = "/quiz_admin.html";
    });
  });
}

async function load(){
  setErr("");
  const q = document.getElementById("q").value.trim();

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

document.getElementById("reload").onclick = ()=>{ OFFSET=0; load().catch(e=>setErr(String(e.message||e))); };
document.getElementById("prev").onclick = ()=>{ OFFSET=Math.max(0, OFFSET-LIMIT); load().catch(e=>setErr(String(e.message||e))); };
document.getElementById("next").onclick = ()=>{ OFFSET=OFFSET+LIMIT; load().catch(e=>setErr(String(e.message||e))); };

let t=null;
document.getElementById("q").addEventListener("input", ()=>{
  clearTimeout(t);
  t=setTimeout(()=>{ OFFSET=0; load().catch(e=>setErr(String(e.message||e))); }, 200);
});

load().catch(e=>setErr(String(e.message||e)));
