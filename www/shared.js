/* NUS Companion - shared data, cloud sync, reminders and NUSMods helpers.
 * Loaded before the app scripts in app/. Everything here is a global so the
 * native iOS shell (NUS Helper IPA/native/native-app.js) can wrap it.
 */

const ACADEMIC_YEAR = "2026-2027";
const SEMESTER = "1";
// The semester the app is on (state.semester) decides which NUSMods data is used.
const nusmodsBase = () => `https://api.nusmods.com/v2/${state.semester?.academicYear || ACADEMIC_YEAR}`;
const currentSemesterNo = () => String(state.semester?.semester || SEMESTER);
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
  places: [],   // saved map places, e.g. {id, name:"Home", icon:"home", lat, lng, address}
  archive: [],  // finished semesters (app/archive.js): {id, academicYear, semester, modules:[{code,name,units,grade,su}], lessons, syllabus}
  gpa: {suLimit:32},
  commutes: [], // saved routes (app/commutes.js)
  busFavs: [],  // starred bus stops on the Buses tab (app/buses.js): {type, code, name, lat, lng}
  syllabus: {modules:[]},   // weekly topics and assessments per module (app/syllabus.js)
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
  state.places=[];
  state.syllabus={modules:[]};
  state.archive=[];
  state.gpa={suLimit:32};
  state.commutes=[];
  state.busFavs=[];
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
      if(Array.isArray(remote.places)) state.places=remote.places;
      if(remote.syllabus && Array.isArray(remote.syllabus.modules)) state.syllabus=remote.syllabus;
      if(Array.isArray(remote.archive)) state.archive=remote.archive;
      if(remote.gpa) state.gpa={suLimit:32,...remote.gpa};
      if(Array.isArray(remote.commutes)) state.commutes=remote.commutes;
      if(Array.isArray(remote.busFavs)) state.busFavs=remote.busFavs;
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

// Graded Completed Satisfactory/Unsatisfactory (CS/CU) on NUSMods, e.g. CFG1002.
function isPassFail(moduleData){
  return /satisfactory\s*\/\s*unsatisfactory/i.test(String(moduleData?.gradingBasisDescription||""));
}

/* ---------- Academic weeks ---------- */

// Monday of Week 1 for each semester, from NUSMods' academic calendar
// (packages/nusmods-academic-calendar). Weeks 1-6, recess, weeks 7-13,
// reading week, then two weeks of exams.
const SEMESTER_STARTS={
  "2025-2026":{1:"2025-08-11",2:"2026-01-12"},
  "2026-2027":{1:"2026-08-10",2:"2027-01-11"},
  "2027-2028":{1:"2027-08-09",2:"2028-01-10"}
};
const TEACHING_WEEKS=[1,2,3,4,5,6,7,8,9,10,11,12,13];

function semesterStart(){
  const iso=SEMESTER_STARTS[state.semester?.academicYear]?.[String(state.semester?.semester)];
  return iso ? new Date(`${iso}T00:00:00`) : null;
}

// {kind:"teaching"|"recess"|"reading"|"exam"|"orientation"|"break", week, label}
// for a date, or null when the semester's dates aren't known.
function academicWeek(date){
  const start=semesterStart();
  if(!start) return null;
  const d=new Date(date); d.setHours(0,0,0,0);
  const i=Math.floor(Math.round((d-start)/86400000)/7);
  if(i>=0&&i<=5) return {kind:"teaching",week:i+1,label:`Week ${i+1}`};
  if(i===6) return {kind:"recess",week:null,label:"Recess week"};
  if(i>=7&&i<=13) return {kind:"teaching",week:i,label:`Week ${i}`};
  if(i===14) return {kind:"reading",week:null,label:"Reading week"};
  if(i===15||i===16) return {kind:"exam",week:null,label:`Exam week ${i-14}`};
  if(i===-1) return {kind:"orientation",week:null,label:"Orientation week"};
  if(i<-1) return {kind:"break",week:null,label:`Sem ${state.semester?.semester} starts ${start.toLocaleDateString("en-SG",{day:"numeric",month:"short"})}`};
  return {kind:"break",week:null,label:"Vacation"};
}

// A lesson's `weeks` is a list of teaching weeks (as NUSMods gives it, e.g.
// [3,5,7,9,11] for alternate-week tutorials) or missing for every week.
// NUSMods sometimes gives a date range instead: {start, end, weekInterval}.
function lessonOccursOnDate(l,date){
  if(l.day!==dayName(date)) return false;
  const w=l.weeks;
  if(w && !Array.isArray(w) && typeof w==="object" && w.start){
    const d=isoDate(date);
    if(d<w.start || (w.end && d>w.end)) return false;
    const n=Math.round((new Date(`${d}T00:00:00`)-new Date(`${w.start}T00:00:00`))/604800000);
    if(Array.isArray(w.weeks)) return w.weeks.includes(n+1);
    return n%(w.weekInterval||1)===0;
  }
  const aw=academicWeek(date);
  if(!aw) return true; // unknown calendar: every week
  if(aw.kind!=="teaching") return false;
  return !Array.isArray(w) || !w.length || w.includes(aw.week);
}

// "Every week", "Odd weeks", "Even weeks" or "Weeks 3, 5, 7–9".
function weeksLabel(weeks){
  if(weeks && !Array.isArray(weeks)) return weeks.weekInterval===2 ? "Every 2 weeks" : "Selected dates";
  const w=[...new Set((weeks||[]).map(Number))].sort((a,b)=>a-b);
  if(!w.length || TEACHING_WEEKS.every(x=>w.includes(x))) return "Every week";
  const same=list=>list.length===w.length && list.every((x,i)=>x===w[i]);
  if(same(TEACHING_WEEKS.filter(x=>x%2))) return "Odd weeks";
  if(same(TEACHING_WEEKS.filter(x=>x%2===0))) return "Even weeks";
  const parts=[];
  for(let i=0;i<w.length;i++){
    let j=i; while(j+1<w.length && w[j+1]===w[j]+1) j++;
    parts.push(j-i>=2?`${w[i]}–${w[j]}`:w.slice(i,j+1).join(", "));
    i=j;
  }
  return `Week${w.length===1?"":"s"} ${parts.join(", ")}`;
}

/* ---------- Schedule queries ---------- */

function activityOccursOnDate(a,date){
  if(a.recurring) return dayName(date)===a.day;
  return a.date===isoDate(date);
}

/* ---------- Assessments as tasks ----------
 * Assessments you complete yourself within a window (online quizzes,
 * assignments, projects, lab submissions) also show as tasks you can tick
 * off. Exams and in-class tests sat at a set time don't. a.task (true/false)
 * overrides the rule; a.done marks it completed. They stay one record in the
 * syllabus, so nothing is copied or duplicated. */
const TASK_ASSESSMENT_TYPES=["quiz","assignment","project","lab"];
function isTaskAssessment(a){
  if(!a?.date) return false;
  if(a.task===true) return true;
  if(a.task===false||a.official) return false;
  return TASK_ASSESSMENT_TYPES.includes(a.type) && !(a.time&&a.endTime);
}

// When an assessment opens: a.opens ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"),
// else a note such as "Opens 00:00 the day before".
function assessmentOpens(a){
  if(a?.opens){
    const d=new Date(String(a.opens).includes("T")?`${a.opens}:00`:`${a.opens}T00:00:00`);
    return isNaN(d)?null:d;
  }
  const m=String(a?.notes||"").match(/\bopens?\s+(?:at\s+)?(\d{1,2})[:.]?(\d{2})(?:\s*(am|pm))?(?:\s+(?:on\s+)?(?:the\s+)?(day before|(\d+)\s+days?\s+before))?/i);
  if(!m||!a.date) return null;
  let h=+m[1];
  if(m[3]){ if(/pm/i.test(m[3])&&h<12) h+=12; if(/am/i.test(m[3])&&h===12) h=0; }
  const d=new Date(`${a.date}T00:00:00`);
  d.setDate(d.getDate()-(m[4]?(m[5]?+m[5]:1):0));
  d.setHours(h,+m[2],0,0);
  return isNaN(d)?null:d;
}

// Your tick decides; an assessment you've never ticked counts as done once it has a score.
const assessmentDone=a=>a.done??(a.score!=null);

// Tracked assessments as task-shaped items for the Tasks tab and Today.
function assessmentTasks(){
  const out=[];
  for(const m of state.syllabus?.modules||[]){
    (m.assessments||[]).forEach((a,i)=>{
      if(!isTaskAssessment(a)) return;
      out.push({id:`assess|${m.code}|${i}`,assessment:true,ref:a,code:m.code,index:i,title:a.title,module:m.code,
        dueDate:a.date,dueTime:a.time||"23:59",done:assessmentDone(a),weight:a.weight,opens:assessmentOpens(a)});
    });
  }
  return out;
}

// Ones already past when they first become tasks (when this arrived, or in a
// newly imported syllabus) were done before the app could track them.
function markPastAssessmentsDone(modules){
  const now=new Date();
  for(const m of modules||[]) for(const a of m.assessments||[]){
    if(a.done==null&&isTaskAssessment(a)&&new Date(`${a.date}T${a.time||"23:59"}:00`)<now) a.done=true;
  }
}

// Your tasks plus tracked assessments.
function allTaskItems(){ return [...state.tasks,...assessmentTasks()]; }
function findTaskItem(id){
  return String(id).startsWith("assess|") ? assessmentTasks().find(t=>t.id===id) : state.tasks.find(t=>t.id===id);
}

function taskDateTime(t){
  return new Date(`${t.dueDate}T${t.dueTime || "23:59"}:00`);
}

function isOverdue(t){ return !t.done && taskDateTime(t)<new Date(); }

// Everything happening on a date, as uniform items sorted by start time.
function itemsOnDate(date){
  const lessons=state.lessons.filter(l=>lessonOccursOnDate(l,date)).map(l=>({
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
  // Assessments from the syllabus (app/syllabus.js) are their own kind, not tasks.
  const iso=isoDate(date), assess=[];
  for(const m of state.syllabus?.modules||[]){
    (m.assessments||[]).forEach((a,i)=>{
      if(a.date!==iso) return;
      const start=timeToMinutes(a.time||"23:59"), end=a.endTime?timeToMinutes(a.endTime):start;
      const w=parseFloat(String(a.weight??"").replace(/[^0-9.]/g,""));
      assess.push({kind:"assessment", id:`${m.code}|${i}`, ref:a, title:a.title,
        subtitle:`${m.code}${Number.isFinite(w)?` · ${+w.toFixed(2)}%`:""}${a.time?"":" · due"}`, venue:a.venue||"", start, end});
    });
  }
  return [...lessons,...acts,...assess,...tasks]
    .filter(x=>x.start!=null)
    .sort((a,b)=>a.start-b.start || (a.kind==="task")-(b.kind==="task"));
}

// The next lesson or activity that hasn't ended yet, looking up to a week ahead.
function nextEvent(){
  const now=new Date();
  const nowMin=now.getHours()*60+now.getMinutes();
  for(let i=0;i<8;i++){
    const date=addDays(now,i);
    const items=itemsOnDate(date).filter(x=>(x.kind==="lesson"||x.kind==="activity") && x.end!=null);
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
// the deadline (plus when overdue), activities 1 day before, assessments 3
// days and 1 day before (at 9am) plus on the day (2 hours before, or 9am
// if untimed), until the assessment has passed.

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

  // Dated assessments from the syllabus (app/syllabus.js).
  for(const m of state.syllabus?.modules||[]){
    for(const a of m.assessments||[]){
      if(!a.date||(isTaskAssessment(a)&&assessmentDone(a))) continue;   // ticked off in Tasks: no more reminders
      const at=new Date(`${a.date}T${a.time||"23:59"}:00`).getTime();
      const nine=new Date(`${a.date}T09:00:00`).getTime();
      if(!Number.isFinite(at) || at<now) continue;
      const key=`assess-${m.code}-${String(a.title).toLowerCase().replace(/[^a-z0-9]+/g,"-")}-${a.date}`;
      const w=parseFloat(String(a.weight??"").replace(/[^0-9.]/g,""));
      const what=`${m.code} ${a.title}${Number.isFinite(w)?` (${+w.toFixed(2)}%)`:""}`;
      const when=`${fmtDate(a.date)}${a.time?`, ${inputTimeToLabel(a.time)}`:""}`;
      const href=`/#/courses/module?code=${encodeURIComponent(m.code)}&tab=assess`;
      add(`${key}-3d`,what,`${a.venue?`${a.venue} · `:""}in 3 days`,nine-3*86400000,"Assessment · 3 days",href,when);
      add(`${key}-1d`,what,`${a.venue?`${a.venue} · `:""}tomorrow`,nine-86400000,"Assessment · 1 day",href,when);
      const dayOf=a.time?at-2*3600000:nine;
      add(`${key}-day`,what,a.time?`${a.venue?`${a.venue} · `:""}in 2 hours`:"today",dayOf,"Assessment · today",href,when);
      // Ones you do yourself: when the window opens.
      const opens=isTaskAssessment(a)?assessmentOpens(a):null;
      if(opens&&opens.getTime()>now) add(`${key}-open`,what,`is open · due ${when}`,opens.getTime(),"Assessment · open now",href,when);
    }
  }

  return items.sort((a,b)=>a.when-b.when);
}

// Reminders that are due, or due within the next day, newest stage per item.
function currentReminders(){
  const now=Date.now(), grouped=new Map();
  for(const item of buildNotificationItems()){
    if(item.when>now+86400000) continue;
    const key=item.id.replace(/-(7d|3d|1d|day|overdue)(-.+)?$/,"");
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
  const r=await fetch(`${nusmodsBase()}/moduleList.json`);
  if(!r.ok) throw new Error(`NUSMods module list failed (${r.status})`);
  nusModuleListCache=await r.json();
  return nusModuleListCache;
}

async function fetchNUSModsModule(code){
  const errors=[];
  let moduleData=null;
  try{
    const r=await fetch(`${nusmodsBase()}/modules/${encodeURIComponent(code)}.json`);
    if(r.ok){
      moduleData=await r.json();
      // Module info lists timetables per semester.
      const sem=(moduleData.semesterData||[]).find(s=>String(s.semester)===currentSemesterNo());
      if(sem && Array.isArray(sem.timetable)) return {...moduleData,timetable:sem.timetable};
      if(Array.isArray(moduleData.timetable)) return moduleData;
    }else errors.push(`module endpoint returned ${r.status}`);
  }catch{ errors.push("module endpoint could not be reached"); }

  try{
    const r=await fetch(`${nusmodsBase()}/semesters/${currentSemesterNo()}/${encodeURIComponent(code)}/timetable.json`);
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
  const units=parseFloat(data.moduleCredit);
  return {moduleCode:data.moduleCode||code,title:data.title||moduleName(code),units:Number.isFinite(units)?units:null,
    pf:isPassFail(data),timetable};
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
