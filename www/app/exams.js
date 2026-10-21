/* Exam timetable: each module's final exam date, time and length for this
 * semester, from NUSMods. The official slot is written into the module's
 * syllabus as its final (matching the imported "Final exam" / "Final
 * assessment" when there is one, so its weight and score stay), or added as
 * a "Final exam" when the syllabus has none. The calendar, reminders, widgets
 * and the push server then all use the real time. NUSMods has no venues
 * (NUS releases them later in EduRec), so you add yours by tapping an exam.
 * Shown at the top of Courses → Assessments.
 */

// "2026-11-24T09:00:00.000Z" -> {date:"2026-11-24", time:"17:00"} in Singapore time.
function sgDateTime(ms){
  const f=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Singapore",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const p=Object.fromEntries(f.formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}

// The imported assessment that is this module's final, if any.
function findFinal(mod,date){
  const list=mod.assessments||[];
  return list.find(a=>a.official)
    || list.find(a=>/\bfinal\b/i.test(a.title||"")&&(a.type==="exam"||/exam|assessment|test|quiz/i.test(a.title||"")))
    || list.find(a=>a.type==="exam"&&a.date===date)
    || null;
}

// Writes NUSMods' slot {examDate, examDuration} into the syllabus. True if anything changed.
function applyExam(code,slot){
  const startMs=new Date(slot.examDate).getTime();
  if(!Number.isFinite(startMs)) return false;
  const mins=Number(slot.examDuration)||120;
  const start=sgDateTime(startMs), end=sgDateTime(startMs+mins*60000);
  if(!state.syllabus) state.syllabus={modules:[]};
  let mod=syllabusModule(code);
  if(!mod){
    mod={code,title:moduleName(code),weeks:[],assessments:[],examOnly:true};
    state.syllabus.modules=[...state.syllabus.modules,mod].sort((a,b)=>a.code.localeCompare(b.code));
  }
  let a=findFinal(mod,start.date);
  if(!a){ a={title:"Final exam",type:"exam"}; mod.assessments=[...(mod.assessments||[]),a]; }
  const before=JSON.stringify(a);
  Object.assign(a,{date:start.date,time:start.time,endTime:end.time,duration:mins,official:true});
  if(a.type!=="exam") a.type="exam";
  return JSON.stringify(a)!==before;
}

let examRefresh=null;
// Checks NUSMods at most twice a day (or now, with force).
function refreshExams({force=false}={}){
  if(!state.modules.length||!accountDataReady) return Promise.resolve();
  const key=`nus_exams_${state.semester.academicYear}_${state.semester.semester}`;
  if(!force){ try{ if(Date.now()-Number(localStorage.getItem(key)||0)<12*3600000) return Promise.resolve(); }catch{} }
  if(examRefresh) return examRefresh;
  examRefresh=(async()=>{
    let changed=false;
    const codes=new Set(state.modules.map(m=>m.code));
    for(const code of codes){
      try{
        const r=await fetch(`${nusmodsBase()}/modules/${encodeURIComponent(code)}.json`);
        if(!r.ok) continue;
        const data=await r.json();
        const slot=(data.semesterData||[]).find(s=>String(s.semester)===currentSemesterNo());
        if(slot?.examDate) changed=applyExam(code,slot)||changed;
      }catch(err){ console.warn(`Exam for ${code} unavailable`,err); }
    }
    // Drop exam-only entries for modules you no longer take.
    const before=(state.syllabus?.modules||[]).length;
    if(state.syllabus) state.syllabus.modules=state.syllabus.modules.filter(m=>!m.examOnly||codes.has(m.code));
    changed=changed||(state.syllabus?.modules||[]).length!==before;
    try{ localStorage.setItem(key,String(Date.now())); }catch{}
    if(changed) await save().catch(()=>{});
  })().finally(()=>{ examRefresh=null; });
  return examRefresh;
}
window.addEventListener("nus-cloud-state-applied",()=>{ refreshExams(); });

/* ---------- Courses → Assessments: exam timetable ---------- */

const dayMs=86400000;
const dayIndex=d=>Math.round(new Date(`${d}T12:00:00`).getTime()/dayMs);

function examTimetableHTML(){
  const exams=allAssessments().filter(a=>a.official&&a.date).sort((a,b)=>a.when-b.when);
  if(!exams.length) return "";
  const now=new Date();
  const upcoming=exams.filter(a=>!a.when||new Date(`${a.date}T${a.endTime||"23:59"}:00`)>=now);
  if(!upcoming.length) return "";
  const rows=upcoming.map((a,i)=>{
    const prev=upcoming[i-1];
    const gap=prev?dayIndex(a.date)-dayIndex(prev.date):null;
    const note=gap===0?`<span class="exam-gap clash">Same day as ${esc(prev.module)}</span>`
      :gap===1?`<span class="exam-gap tight">Day after ${esc(prev.module)}</span>`
      :gap!=null?`<span class="exam-gap">${gap} days after ${esc(prev.module)}</span>`:"";
    const d=new Date(`${a.date}T12:00:00`);
    const days=Math.ceil((new Date(a.date+"T00:00:00")-new Date().setHours(0,0,0,0))/dayMs);
    return `${note}<button class="exam-row" data-exam="${esc(a.module)}">
      <span class="exam-date"><b>${d.getDate()}</b><small>${d.toLocaleDateString("en-SG",{month:"short"})}</small></span>
      <span class="exam-main"><b>${esc(a.module)} · ${esc(a.title)}${weightValue(a.weight)!=null?` <i class="assess-weight">${esc(weightLabel(a.weight))}</i>`:""}</b>
        <small>${d.toLocaleDateString("en-SG",{weekday:"short"})} ${esc(inputTimeToLabel(a.time))}–${esc(inputTimeToLabel(a.endTime))} · ${a.duration||120} min</small>
        <small class="${a.venue?"":"exam-novenue"}">${a.venue?esc(a.venue):"Add venue and seat"}</small></span>
      <span class="assess-count ${days<=7?"soon":""}">${days<=0?"Today":days===1?"Tomorrow":`${days} days`}</span>
    </button>`;
  }).join("");
  return `<div class="card exam-card">
    <div class="side-head"><h4>Exam timetable</h4><button class="link" id="examRefresh">Update</button></div>
    ${rows}
    <p class="small-help">Official dates and times from NUSMods. Venues come out in EduRec nearer the time; tap an exam to add yours.</p>
  </div>`;
}

function openExamVenue(code){
  const a=(syllabusModule(code)?.assessments||[]).find(x=>x.official);
  if(!a) return;
  openModal(`<p class="kicker">${esc(code)} · ${esc(assessmentWhen(a))}</p><h2>${esc(a.title)}</h2>
    <form class="form" id="venueForm">
      <label>Venue and seat<input class="input" name="venue" value="${esc(a.venue||"")}" placeholder="e.g. MPSH 2A, seat 123" autocomplete="off"></label>
      <p class="small-help">Shown on the exam and in its reminders.</p>
      <button class="btn primary full">Save</button>
    </form>`);
  $("#venueForm").onsubmit=e=>{
    e.preventDefault();
    const v=String(new FormData(e.target).get("venue")||"").trim();
    if(v) a.venue=v; else delete a.venue;
    closeModal(); save(); toast("Saved");
  };
}

function bindExamTimetable(el){
  $$("[data-exam]",el).forEach(b=>b.onclick=()=>openExamVenue(b.dataset.exam));
  $("#examRefresh",el)?.addEventListener("click",async e=>{
    e.target.textContent="Updating…";
    await refreshExams({force:true});
    toast("Exam timetable is up to date");
    views.courses?.refresh?.();
  });
}
