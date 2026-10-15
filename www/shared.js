/* NUS Companion - shared data, cloud sync, reminders and NUSMods helpers.
 * Loaded before the app scripts in app/. Everything here is a global so the
 * native iOS shell (NUS Helper IPA/native/native-app.js) can wrap it.
 */

const ACADEMIC_YEAR = "2026-2027";
const SEMESTER = "1";
const NUSMODS_BASE = `https://api.nusmods.com/v2/${ACADEMIC_YEAR}`;
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function uid(){ return crypto.randomUUID?.() || String(Date.now()+Math.random()); }
function isNativeApp(){ return !!window.Capacitor?.isNativePlatform?.(); }

const state = {
  modules: [],
  lessons: [],
  activities: [],
  tasks: [],
  semester: {academicYear:ACADEMIC_YEAR, semester:SEMESTER}
};

/* ---------- Cloud save ---------- */

let cloudSaveTimer = null;
let cloudSyncStop = null;
let lastLocalCloudChangeAt = 0;
let lastRemoteCloudChangeAt = 0;
let cloudWriteQueue = Promise.resolve();
let accountDataReady = false;
let activeAccountUid = null;

// Every edit calls save(). Writes are debounced and queued so rapid edits
// collapse into one Firestore write and never overtake each other.
async function save(options={}){
  const api=window.nusFirebase;
  if(!api?.configured || !api?.user) throw new Error("You must be signed in to save.");
  if(!accountDataReady || activeAccountUid!==api.user.uid) throw new Error("Your account data is still loading. Please wait.");
  lastLocalCloudChangeAt=Date.now();
  window.dispatchEvent(new CustomEvent("nus-data-changed"));
  const snapshot=clone(state);
  const write=()=>api.saveState(snapshot);

  if(options.immediate){
    clearTimeout(cloudSaveTimer);
    cloudWriteQueue=cloudWriteQueue.then(write,write);
    return cloudWriteQueue;
  }

  clearTimeout(cloudSaveTimer);
  return new Promise((resolve,reject)=>{
    cloudSaveTimer=setTimeout(()=>{
      cloudWriteQueue=cloudWriteQueue.then(write,write);
      cloudWriteQueue.then(resolve).catch(err=>{
        console.error("Cloud save failed",err);
        toast("Could not save to the cloud. Please try again.");
        reject(err);
      });
    },350);
  });
}

function readableFirebaseError(error){
  const map={
    "auth/unauthorized-domain":"This domain is not authorised in Firebase Authentication.",
    "auth/operation-not-allowed":"This sign-in method is not enabled in Firebase.",
    "auth/popup-closed-by-user":"Sign-in was cancelled.",
    "auth/network-request-failed":"Could not connect to the network.",
  };
  return map[error?.code] || error?.message || "Something went wrong.";
}

function resetState(){
  state.modules=[];
  state.lessons=[];
  state.activities=[];
  state.tasks=[];
  state.semester={academicYear:ACADEMIC_YEAR, semester:SEMESTER};
  lastRemoteCloudChangeAt=0;
}

// Starts realtime sync for the signed-in user. Resolves once their data has
// been loaded for the first time (or confirmed empty for a new account).
function startCloudSync(){
  const api=window.nusFirebase;
  let resolveReady;
  const ready=new Promise(r=>{resolveReady=r;});

  const apply=remote=>{
    const user=api?.user;
    if(!user) return;
    if(activeAccountUid && activeAccountUid!==user.uid) return;
    activeAccountUid=user.uid;

    if(remote){
      const changedAt=Number(remote.clientUpdatedAt||0);
      // Ignore echoes of our own older writes and duplicate snapshots.
      if(changedAt && changedAt < lastLocalCloudChangeAt) return;
      if(changedAt && changedAt === lastRemoteCloudChangeAt && accountDataReady) return;
      lastRemoteCloudChangeAt=changedAt || Date.now();
      if(Array.isArray(remote.modules)) state.modules=remote.modules;
      if(Array.isArray(remote.lessons)) state.lessons=remote.lessons;
      if(Array.isArray(remote.activities)) state.activities=remote.activities;
      if(Array.isArray(remote.tasks)) state.tasks=remote.tasks;
      if(remote.semester) state.semester=remote.semester;
    }

    accountDataReady=true;
    resolveReady();
    window.dispatchEvent(new CustomEvent("nus-cloud-state-applied"));
    window.dispatchEvent(new CustomEvent("nus-data-changed"));
  };

  resetState();
  activeAccountUid=api.user.uid;
  accountDataReady=false;

  if(cloudSyncStop) cloudSyncStop();
  cloudSyncStop=api.startStateSync(apply,err=>{
    console.error("Realtime cloud sync failed",err);
    toast("Live sync paused. Your changes are still saved.");
  });

  // A brand-new account has no document, so the realtime listener never
  // fires. Load once directly so the app can start either way.
  api.loadState().then(apply).catch(err=>{
    console.error("Initial cloud load failed",err);
    toast("Could not load your data. Check your connection.");
    accountDataReady=true;
    resolveReady();
  });

  return ready;
}

async function syncNow(){
  await window.nusFirebase.saveState(state);
  toast("Synced");
}

async function signOutUser(){
  if(cloudSyncStop){ cloudSyncStop(); cloudSyncStop=null; }
  accountDataReady=false;
  activeAccountUid=null;
  resetState();
  await window.nusFirebase.signOut();
  location.replace("/login.html");
}

/* ---------- Formatting helpers ---------- */

function esc(v=""){
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function timeToMinutes(v){
  if(v == null || v === "") return null;
  const s=String(v).trim().toUpperCase();
  const m=s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if(m){
    let h=+m[1], min=+m[2];
    if(m[3]==="PM" && h!==12) h+=12;
    if(m[3]==="AM" && h===12) h=0;
    return h*60+min;
  }
  const hhmm=s.match(/^(\d{1,2}):(\d{2})$/);
  if(hhmm){
    const h=+hhmm[1], min=+hhmm[2];
    if(h>=0 && h<=23 && min>=0 && min<=59) return h*60+min;
  }
  if(/^\d{3,4}$/.test(s)){
    const p=s.padStart(4,"0");
    const h=+p.slice(0,2), min=+p.slice(2);
    return h<=23 && min<=59 ? h*60+min : null;
  }
  return null;
}

function minutesToInput(m){
  if(m==null) return "";
  return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
}

function minutesLabel(m){
  if(m==null) return "TBC";
  const h=Math.floor(m/60), min=m%60;
  return `${h%12||12}:${String(min).padStart(2,"0")} ${h>=12?"PM":"AM"}`;
}

function inputTimeToLabel(v){ return v ? minutesLabel(timeToMinutes(v)) : "TBC"; }

function parseTimeRange(v){
  if(!v) return null;
  const p=String(v).split(/\s*[–—-]\s*/);
  if(p.length<2) return null;
  const a=timeToMinutes(p[0]), b=timeToMinutes(p[1]);
  return a==null||b==null ? null : {start:a,end:b};
}

function isoDate(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

function startOfWeek(d){
  const x=new Date(d);
  x.setDate(x.getDate()-(x.getDay()+6)%7);
  x.setHours(0,0,0,0);
  return x;
}

function sameDay(a,b){ return a.toDateString()===b.toDateString(); }
function dayName(d){ return DAYS[(d.getDay()+6)%7]; }

function fmtDate(s){
  if(!s) return "No date";
  return new Date(`${s}T12:00:00`).toLocaleDateString("en-SG",{day:"numeric",month:"short",year:"numeric"});
}

// "Today", "Tomorrow", "Wed", or "12 Nov" relative to now.
function relativeDay(d){
  const today=new Date(); today.setHours(0,0,0,0);
  const x=new Date(d); x.setHours(0,0,0,0);
  const diff=Math.round((x-today)/86400000);
  if(diff===0) return "Today";
  if(diff===1) return "Tomorrow";
  if(diff===-1) return "Yesterday";
  if(diff>1 && diff<7) return x.toLocaleDateString("en-SG",{weekday:"long"});
  return x.toLocaleDateString("en-SG",{day:"numeric",month:"short"});
}

function durationLabel(mins){
  if(mins<1) return "now";
  if(mins<60) return `${mins} min`;
  const h=Math.floor(mins/60), m=mins%60;
  if(h<24) return m?`${h}h ${m}m`:`${h}h`;
  const d=Math.round(h/24);
  return `${d} day${d===1?"":"s"}`;
}

function moduleName(code){ return state.modules.find(m=>m.code===code)?.name || code || "No module"; }

/* ---------- Schedule queries ---------- */

function activityOccursOnDate(a,date){
  if(a.recurring) return dayName(date)===a.day;
  return a.date===isoDate(date);
}

function taskDateTime(t){
  return new Date(`${t.dueDate}T${t.dueTime || "23:59"}:00`);
}

function isOverdue(t){ return !t.done && taskDateTime(t)<new Date(); }

// Everything happening on a date, as uniform items sorted by start time.
function itemsOnDate(date){
  const day=dayName(date);
  const lessons=state.lessons.filter(l=>l.day===day).map(l=>({
    kind:"lesson", id:l.id, ref:l,
    title:l.module, subtitle:`${l.lessonType||"Class"}${l.classNo&&l.classNo!=="TBC"?` ${l.classNo}`:""}`,
    venue:l.venue, start:timeToMinutes(l.startTime), end:timeToMinutes(l.endTime)
  }));
  const acts=state.activities.filter(a=>activityOccursOnDate(a,date)).map(a=>({
    kind:"activity", id:a.id, ref:a,
    title:a.name, subtitle:a.club||"Activity",
    venue:a.venue, start:timeToMinutes(a.startTime), end:timeToMinutes(a.endTime)
  }));
  const tasks=state.tasks.filter(t=>t.dueDate===isoDate(date)).map(t=>{
    const due=timeToMinutes(t.dueTime||"23:59");
    return {kind:"task", id:t.id, ref:t, title:t.title, subtitle:t.module?`${t.module} · due`:"Due", start:due, end:due, done:t.done};
  });
  return [...lessons,...acts,...tasks]
    .filter(x=>x.start!=null)
    .sort((a,b)=>a.start-b.start || (a.kind==="task")-(b.kind==="task"));
}

// The next lesson or activity that hasn't ended yet, looking up to a week ahead.
function nextEvent(){
  const now=new Date();
  const nowMin=now.getHours()*60+now.getMinutes();
  for(let i=0;i<8;i++){
    const date=addDays(now,i);
    const items=itemsOnDate(date).filter(x=>x.kind!=="task" && x.end!=null);
    const found=i===0 ? items.find(x=>x.end>nowMin) : items[0];
    if(found){
      const start=new Date(date); start.setHours(0,found.start,0,0);
      const end=new Date(date); end.setHours(0,found.end,0,0);
      return {...found,date,startAt:start,endAt:end};
    }
  }
  return null;
}

/* ---------- Reminders ---------- */
// Same rules as push-server/send-reminders.mjs: tasks 7 days and 1 day before
// the deadline (plus when overdue), activities 1 day before.

const NOTIFICATION_KEY="nus_notification_log_v59";

function buildNotificationItems(){
  const now=new Date(), items=[];
  const add=(id,title,body,when,kind,href,deadline="")=>{
    const t=new Date(when).getTime();
    if(Number.isFinite(t)) items.push({id,title,body,when:t,kind,href,deadline});
  };

  for(const task of state.tasks){
    if(task.done || !task.dueDate) continue;
    const due=taskDateTime(task);
    if(Number.isNaN(due.getTime())) continue;
    add(`${task.id}-7d`,task.title,`${task.module||"Task"} · due ${fmtDate(task.dueDate)}`,due.getTime()-7*86400000,"Task · 7 days","/#/tasks",fmtDate(task.dueDate));
    add(`${task.id}-1d`,task.title,`${task.module||"Task"} · due tomorrow`,due.getTime()-86400000,"Task · 1 day","/#/tasks",fmtDate(task.dueDate));
    if(due<=now) add(`${task.id}-overdue`,task.title,`${task.module||"Task"} · overdue`,due,"Task · overdue","/#/tasks",fmtDate(task.dueDate));
  }

  // Recurring activities: remind for the next occurrence only.
  for(const a of state.activities){
    let d=null;
    if(a.recurring && a.day){
      const target=["Sunday",...DAYS.slice(0,6)].indexOf(a.day);
      if(target>=0){
        d=new Date(now); d.setHours(0,0,0,0);
        let delta=(target-d.getDay()+7)%7;
        if(delta===0 && now.getHours()>=12) delta=7;
        d.setDate(d.getDate()+delta);
        d.setHours(...(a.startTime||"09:00").split(":").map(Number),0,0);
      }
    }else if(a.date){
      d=new Date(`${a.date}T${a.startTime||"09:00"}:00`);
    }
    if(!d || Number.isNaN(d.getTime())) continue;
    const label=a.recurring ? `${a.day} (next occurrence)` : fmtDate(a.date);
    add(`${a.id}-1d-${a.recurring?isoDate(d):a.date}`,a.name,`${a.club||"Activity"} · tomorrow`,d.getTime()-86400000,"Activity · 1 day","/#/more/activities",label);
  }

  return items.sort((a,b)=>a.when-b.when);
}

// Reminders that are due, or due within the next day, newest stage per item.
function currentReminders(){
  const now=Date.now(), grouped=new Map();
  for(const item of buildNotificationItems()){
    if(item.when>now+86400000) continue;
    const key=item.id.replace(/-(7d|1d|overdue)(-.+)?$/,"");
    const prev=grouped.get(key);
    if(!prev || item.when>prev.when) grouped.set(key,item);
  }
  return [...grouped.values()].sort((a,b)=>a.when-b.when);
}

function notificationStatus(){
  return "Notification" in window ? Notification.permission : "unsupported";
}

async function enableWebPushNotifications(){
  if(!window.nusFirebase?.user){
    toast("Please sign in first.");
    return false;
  }
  if(!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)){
    toast(/iPhone|iPad/.test(navigator.userAgent)
      ? "Add NUS Companion to your Home Screen first, then enable notifications from there."
      : "This browser doesn't support push notifications.");
    return false;
  }
  const key=window.NUS_PUSH_CONFIG?.vapidPublicKey;
  if(!key || key.includes("YOUR_")){
    toast("Push notifications are not configured.");
    return false;
  }
  if(await Notification.requestPermission()!=="granted"){
    toast("Notifications were not allowed.");
    return false;
  }
  try{
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){
      const padding="=".repeat((4-key.length%4)%4);
      const raw=Uint8Array.from(atob((key+padding).replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
      subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:raw});
    }
    await window.nusFirebase.savePushSubscription(subscription.toJSON());
    toast("Reminders turned on");
    return true;
  }catch(err){
    console.error("Web Push subscription failed",err);
    toast(`Couldn't turn on reminders: ${err.message||err}`);
    return false;
  }
}

/* ---------- PWA install ---------- */

let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferredPrompt=e; });

function canInstallApp(){
  if(isNativeApp()) return false;
  return !(matchMedia("(display-mode: standalone)").matches || navigator.standalone===true);
}

async function setupInstall(){
  if(deferredPrompt){
    await deferredPrompt.prompt();
    deferredPrompt=null;
    return;
  }
  openModal(`<h2>Install NUS Companion</h2><p class="subtle">In Safari or Brave, tap the Share button and choose <b>Add to Home Screen</b>.</p>`);
}

/* ---------- NUSMods ---------- */

let nusModuleListCache=null;
async function fetchNUSModsList(){
  if(nusModuleListCache) return nusModuleListCache;
  const r=await fetch(`${NUSMODS_BASE}/moduleList.json`);
  if(!r.ok) throw new Error(`NUSMods module list failed (${r.status})`);
  nusModuleListCache=await r.json();
  return nusModuleListCache;
}

async function fetchNUSModsModule(code){
  const errors=[];
  let moduleData=null;
  try{
    const r=await fetch(`${NUSMODS_BASE}/modules/${encodeURIComponent(code)}.json`);
    if(r.ok){
      moduleData=await r.json();
      // Module info lists timetables per semester.
      const sem=(moduleData.semesterData||[]).find(s=>String(s.semester)===SEMESTER);
      if(sem && Array.isArray(sem.timetable)) return {...moduleData,timetable:sem.timetable};
      if(Array.isArray(moduleData.timetable)) return moduleData;
    }else errors.push(`module endpoint returned ${r.status}`);
  }catch{ errors.push("module endpoint could not be reached"); }

  try{
    const r=await fetch(`${NUSMODS_BASE}/semesters/${SEMESTER}/${encodeURIComponent(code)}/timetable.json`);
    if(r.ok){
      const timetable=await r.json();
      return {...(moduleData||{}),moduleCode:moduleData?.moduleCode||code,title:moduleData?.title||moduleName(code),
        timetable:Array.isArray(timetable)?timetable:(timetable?.timetable||[])};
    }
    errors.push(`semester timetable returned ${r.status}`);
  }catch{ errors.push("semester timetable could not be reached"); }

  if(moduleData) return {...moduleData,moduleCode:moduleData.moduleCode||code,title:moduleData.title||code,timetable:[]};
  throw new Error(`${code} could not be loaded from NUSMods (${errors.join("; ")}).`);
}

function normaliseLessonData(data, code){
  const raw=Array.isArray(data.timetable)?data.timetable:[];
  const normaliseTime=v=>{
    if(v==null||v==="") return "";
    const n=timeToMinutes(v);
    return n==null ? String(v) : minutesToInput(n);
  };
  const normaliseDay=v=>{
    const text=String(v||"").trim();
    return DAYS.find(d=>d.toLowerCase()===text.toLowerCase())||text;
  };
  const timetable=raw.map((x,i)=>{
    if(!x||typeof x!=="object") return null;
    const range=parseTimeRange(x.time||x.timeRange||"");
    return {
      ...x,
      id:x.id||`${code}-lesson-${i}`,
      module:code,
      lessonType:x.lessonType||x.type||"Class",
      classNo:String(x.classNo??x.ClassNo??x.group??"TBC"),
      day:normaliseDay(x.day||x.dayText||""),
      startTime:normaliseTime(x.startTime??x.start??(range?minutesToInput(range.start):"")),
      endTime:normaliseTime(x.endTime??x.end??(range?minutesToInput(range.end):"")),
      venue:x.venue||x.location||""
    };
  }).filter(x=>x && x.day && x.startTime && x.endTime);
  return {moduleCode:data.moduleCode||code,title:data.title||moduleName(code),timetable};
}

// [["Lecture::1",[lessons]], ...]
function lessonGroups(data){
  const groups=new Map();
  for(const l of data.timetable){
    const key=`${l.lessonType||"Class"}::${String(l.classNo||"TBC").trim()||"TBC"}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(l);
  }
  return [...groups.entries()];
}

function lessonKey(l){ return `${l.lessonType||"Class"}::${String(l.classNo??"TBC")}`; }
