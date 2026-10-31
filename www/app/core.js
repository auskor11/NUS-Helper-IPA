/* NUS Companion - app shell: tab navigation, bottom sheets, toasts, startup.
 *
 * The whole app is one page. Tabs are views that are created once and then
 * shown/hidden, so switching tabs is instant and the map keeps its position.
 * Routes look like #/map?stop=CLB.
 */

const views = {};       // name -> {title, mount(el), show(params), refresh()}
const mounted = {};     // name -> container element
let activeView = null;

const TABS = [
  {name:"today",    label:"Today",    icon:"M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"},
  {name:"schedule", label:"Schedule", icon:"M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"},
  {name:"courses",  label:"Courses",  icon:"M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM9 7h7M9 11h5"},
  {name:"tasks",    label:"Tasks",    icon:"M9 11l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"},
  {name:"buses",    label:"Buses",    icon:"M8 6v6M16 6v6M2 12h20M7 18h.01M17 18h.01M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3zM6 20v1M18 20v1"},
  {name:"map",      label:"Map",      icon:"M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"}
];
// Settings (the "more" view and its pages) opens from the gear on Today.
const SETTINGS_ICON="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z";

function icon(path,size=22){
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

/* ---------- Navigation ---------- */

function go(route, params={}){
  const qs=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=="")).toString();
  const hash=`#/${route}${qs?`?${qs}`:""}`;
  if(location.hash===hash) handleRoute();
  else location.hash=hash;
}

function parseRoute(){
  const raw=location.hash.replace(/^#\/?/,"");
  const [path,qs]=raw.split("?");
  const name=path||"today";
  return {name:views[name]?name:"today", params:Object.fromEntries(new URLSearchParams(qs||""))};
}

function handleRoute(){
  closeModal();
  const {name,params}=parseRoute();
  const view=views[name];

  if(!mounted[name]){
    const el=document.createElement("section");
    el.className=`view view-${name.replace("/","-")}`;
    $("#views").appendChild(el);
    mounted[name]=el;
    view.mount(el);
  }
  for(const [n,el] of Object.entries(mounted)) el.hidden=n!==name;
  activeView=name;
  document.body.dataset.view=name.split("/")[0];

  const tab=name.split("/")[0];
  $$(".tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));
  document.title=`${view.title} · NUS Companion`;
  view.show?.(params);
  if(!view.keepScroll) window.scrollTo(0,0);
}

// Re-render the visible view when data changes; others refresh when shown.
let refreshQueued=false;
window.addEventListener("nus-data-changed",()=>{
  if(refreshQueued) return;
  refreshQueued=true;
  requestAnimationFrame(()=>{
    refreshQueued=false;
    if(activeView) views[activeView]?.refresh?.();
  });
});

/* ---------- Page header used by most views ---------- */

function pageHeader(title, {eyebrow="", actions="", back=""}={}){
  return `<header class="page-head">
    ${back?`<button class="icon-btn back-btn" data-go="${esc(back)}" aria-label="Back">${icon("M15 18l-6-6 6-6")}</button>`:""}
    <div class="page-head-text">${eyebrow?`<p class="eyebrow">${eyebrow}</p>`:""}<h1>${title}</h1></div>
    <div class="page-head-actions">${actions}</div>
  </header>`;
}

// Any element with data-go="route" (and optional data-params JSON) navigates.
document.addEventListener("click",e=>{
  const el=e.target.closest("[data-go]");
  if(!el) return;
  e.preventDefault();
  let params={};
  try{ params=JSON.parse(el.dataset.params||"{}"); }catch{}
  go(el.dataset.go,params);
});

// Venue chips open the map tab with that venue pinned.
function venueLink(venue, cls="venue-chip"){
  const label=String(venue||"").trim();
  if(!label || /^(TBC|N\/A|-)$/i.test(label)) return `<span class="${cls} muted">Venue TBC</span>`;
  return `<button type="button" class="${cls}" data-go="map" data-params='${esc(JSON.stringify({venue:label}))}'>${icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",13)}${esc(label)}</button>`;
}

/* ---------- Bottom sheet (modal) ---------- */

let sheetOnClose=null;

function openModal(html, {onClose=null, wide=false}={}){
  const b=$("#sheetBackdrop");
  $("#sheetContent").innerHTML=html;
  $("#sheet").classList.toggle("wide",wide);
  sheetOnClose=onClose;
  b.hidden=false;
  requestAnimationFrame(()=>b.classList.add("open"));
  document.body.classList.add("sheet-open");
  $("#sheet").scrollTop=0;
}

function closeModal(){
  const b=$("#sheetBackdrop");
  if(!b || b.hidden) return;
  b.classList.remove("open");
  document.body.classList.remove("sheet-open");
  setTimeout(()=>{ if(!b.classList.contains("open")){ b.hidden=true; $("#sheetContent").innerHTML=""; } },220);
  const cb=sheetOnClose; sheetOnClose=null; cb?.();
}

function confirmSheet(message, {confirm="Delete", danger=true}={}){
  return new Promise(resolve=>{
    openModal(`<h2>${esc(message)}</h2>
      <div class="sheet-actions">
        <button class="btn secondary" id="confirmNo">Cancel</button>
        <button class="btn ${danger?"danger":"primary"}" id="confirmYes">${esc(confirm)}</button>
      </div>`,{onClose:()=>resolve(false)});
    $("#confirmNo").onclick=()=>closeModal();
    $("#confirmYes").onclick=()=>{ sheetOnClose=null; closeModal(); resolve(true); };
  });
}

// toast("Saved") or toast("Done", {action:{label:"Add score", run(){…}}}).
function toast(msg,{action=null}={}){
  const x=document.createElement("div");
  x.className="toast"; x.textContent=msg;
  if(action){
    const b=document.createElement("button");
    b.className="toast-action"; b.textContent=action.label;
    b.onclick=()=>{ x.remove(); action.run(); };
    x.appendChild(b);
  }
  document.body.appendChild(x);
  const life=action?4500:2300;
  setTimeout(()=>x.classList.add("hide"),life);
  setTimeout(()=>x.remove(),life+400);
}

/* ---------- Theme ---------- */

// Follows the device's light/dark setting until the user picks one in More.
function applyTheme(){
  const saved=localStorage.getItem("nus_theme");
  const light=saved ? saved==="light" : matchMedia("(prefers-color-scheme: light)").matches;
  document.body.classList.toggle("light",light);
  $('meta[name="theme-color"]')?.setAttribute("content",light?"#f6f7fb":"#0b0d12");
}

function setTheme(mode){
  localStorage.setItem("nus_theme",mode);
  applyTheme();
}

/* ---------- Startup ---------- */

function renderShell(){
  document.body.insertAdjacentHTML("afterbegin",`
    <nav class="tabbar" aria-label="Main">
      <div class="tabbar-brand"><div class="brand-mark">N</div><span>NUS Companion</span></div>
      ${TABS.map(t=>`<a class="tab" href="#/${t.name}" data-tab="${t.name}">${icon(t.icon)}<span>${t.label}</span></a>`).join("")}
      <a class="tab tab-settings" href="#/more" data-tab="more">${icon(SETTINGS_ICON)}<span>Settings</span></a>
    </nav>
    <main id="views"></main>
    <div class="sheet-backdrop" id="sheetBackdrop" hidden>
      <div class="sheet" id="sheet" role="dialog" aria-modal="true">
        <div class="sheet-grabber"></div>
        <button class="sheet-close" id="sheetClose" aria-label="Close">${icon("M6 6l12 12M18 6 6 18",20)}</button>
        <div id="sheetContent"></div>
      </div>
    </div>`);
  $("#sheetClose").onclick=closeModal;
  $("#sheetBackdrop").addEventListener("click",e=>{ if(e.target.id==="sheetBackdrop") closeModal(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeModal(); });
}

async function boot(){
  applyTheme();
  try{
    const api=await window.nusFirebaseReady;
    const user=api?.configured ? await window.nusAuthReady : null;
    if(!user){ location.replace("/login.html"); return; }

    await startCloudSync();
    window.addEventListener("nus-auth-changed",e=>{ if(!e.detail) location.replace("/login.html"); });
  }catch(err){
    console.error("Startup failed",err);
    $("#splashText").textContent="Couldn't load your account. Check your connection and reopen the app.";
    return;
  }

  renderShell();
  $("#splash")?.remove();
  window.addEventListener("hashchange",handleRoute);
  handleRoute();
}

matchMedia("(prefers-color-scheme: light)").addEventListener?.("change",applyTheme);
document.addEventListener("DOMContentLoaded",boot);
