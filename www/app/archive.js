/* Archive, GPA and S/U.
 *   state.archive: finished semesters, newest last:
 *     {id, academicYear, semester, archivedAt, manual, modules:[{code,name,units,grade,su}], lessons, syllabus}
 *   state.modules[i].grade / .su: this semester's expected grade and S/U plan.
 *   .pf: graded CS/CU only (pass/fail, from NUSMods), so the grade is CS or CU.
 *   state.gpa.suLimit: S/U units allowed (NUS: 32 for most students).
 *   state.gpa.plan: modules planned for later semesters [{id,code,name,units,grade,su,pf}]
 *     and state.gpa.target: the cumulative GPA you're aiming for. Timetables
 *     and clashes stay in NUSMods; this only projects your GPA.
 * Shown as Courses → GPA, and courses/semester for one past semester.
 */

// NUS 5-point scale. CS/CU (completed (un)satisfactorily) carry no grade points.
const GRADE_POINTS={"A+":5,"A":5,"A-":4.5,"B+":4,"B":3.5,"B-":3,"C+":2.5,"C":2,"D+":1.5,"D":1,"F":0};
const GRADE_OPTIONS=[...Object.keys(GRADE_POINTS),"CS","CU"];

function semesterLabel(ay,sem){
  const [a,b]=String(ay||"").split("-");
  return `AY${a||"?"}/${(b||"").slice(2)} Sem ${sem}`;
}

function nextSemester({academicYear,semester}){
  if(String(semester)==="1") return {academicYear,semester:"2"};
  const [a,b]=String(academicYear).split("-").map(Number);
  return {academicYear:`${a+1}-${b+1}`,semester:"1"};
}

const unitsOf=m=>{ const u=parseFloat(m.units); return Number.isFinite(u)&&u>=0?u:4; };
// Counts towards GPA: has a letter grade and isn't S/U'd.
const countsForGpa=m=>!m.su && m.grade in GRADE_POINTS;

function gpaOf(modules){
  let pts=0, units=0;
  for(const m of modules) if(countsForGpa(m)){ pts+=GRADE_POINTS[m.grade]*unitsOf(m); units+=unitsOf(m); }
  return {gpa:units?pts/units:null, units, pts};
}

const pastModules=()=>(state.archive||[]).flatMap(s=>s.modules||[]);
const suUnitsUsed=(withCurrent=true)=>[...pastModules(),...(withCurrent?state.modules:[])].filter(m=>m.su).reduce((n,m)=>n+unitsOf(m),0);
const gpaText=g=>g==null?"–":g.toFixed(2);

// This semester's S/U options: for each graded, un-S/U'd module that fits in
// the remaining S/U units, the cumulative GPA if it were S/U'd.
function suSuggestions(){
  const left=(state.gpa?.suLimit??32)-suUnitsUsed();
  const base=gpaOf([...pastModules(),...state.modules]).gpa;
  return state.modules.filter(m=>countsForGpa(m)&&unitsOf(m)<=left).map(m=>{
    const g=gpaOf([...pastModules(),...state.modules.map(x=>x===m?{...x,su:true}:x)]).gpa;
    return {m,gpa:g,delta:g!=null&&base!=null?g-base:0};
  }).filter(x=>x.delta>0.0005).sort((a,b)=>b.delta-a.delta);
}

// True once the current semester's exams are over (NUSMods calendar).
function semesterEnded(){
  const start=semesterStart();
  return !!start && new Date()>addDays(start,119);
}

/* ---------- Finish semester ---------- */

function openFinishSemester(){
  const cur=state.semester, next=nextSemester(cur);
  const graded=state.modules.filter(m=>m.grade).length;
  openModal(`<p class="kicker">${esc(semesterLabel(cur.academicYear,cur.semester))}</p><h2>Finish this semester?</h2>
    <p class="subtle">Your ${state.modules.length} module${state.modules.length===1?"":"s"}, timetable, syllabus and scores move to <b>Past semesters</b> (Courses → GPA), where you can still see them and enter final grades. The app then moves to <b>${esc(semesterLabel(next.academicYear,next.semester))}</b>.</p>
    <p class="small-help">Tasks and activities stay as they are.${graded<state.modules.length?` ${state.modules.length-graded} module${state.modules.length-graded===1?" has":"s have"} no grade yet; add it later when results are out.`:""}</p>
    <div class="sheet-actions"><button class="btn primary" id="doFinish">Finish semester</button></div>`);
  $("#doFinish").onclick=()=>{
    const entry={id:uid(),academicYear:cur.academicYear,semester:String(cur.semester),archivedAt:Date.now(),
      modules:state.modules.map(m=>({code:m.code,name:m.name||"",units:unitsOf(m),grade:m.grade||"",su:!!m.su,...(m.pf?{pf:true}:{})})),
      lessons:clone(state.lessons), syllabus:clone(state.syllabus||{modules:[]})};
    state.archive=[...(state.archive||[]),entry];
    state.modules=[]; state.lessons=[]; state.syllabus={modules:[]};
    state.semester=next;
    save({immediate:true});
    closeModal();
    toast(`Welcome to ${semesterLabel(next.academicYear,next.semester)}`);
    go("courses",{mode:"gpa"});
  };
}

function finishBannerHTML(){
  if(!semesterEnded()||!state.modules.length) return "";
  return `<button class="banner finish-banner" data-finish>${icon("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z",18)}
    <span><b>${esc(semesterLabel(state.semester.academicYear,state.semester.semester))} is over</b> · Finish it to start next semester</span>${icon("M9 18l6-6-6-6",18)}</button>`;
}

/* ---------- Courses → GPA ---------- */

let unitsLookupDone=false;
// Modules added before units and pass/fail were recorded: look them up once
// on NUSMods. A pass/fail module starts as CS (passed).
async function fillMissingUnits(){
  if(unitsLookupDone) return;
  unitsLookupDone=true;
  let changed=false;
  for(const m of state.modules.filter(m=>m.units==null||m.pf==null)){
    try{
      const d=await getJSON(`${nusmodsBase()}/modules/${encodeURIComponent(m.code)}.json`);
      const u=parseFloat(d.moduleCredit); if(m.units==null&&Number.isFinite(u)) m.units=u;
      m.pf=isPassFail(d);
      if(m.pf&&!(m.grade==="CS"||m.grade==="CU")){ m.grade="CS"; m.su=false; }
      changed=true;
    }catch{}
  }
  if(changed) save();
}

function gradeSelectHTML(value,attrs,pf=false){
  const opts=pf?[["CS","Pass"],["CU","Fail"]]:[["","–"],...GRADE_OPTIONS.map(g=>[g,g])];
  return `<select class="grade-select ${value?"set":""} ${pf?"pf":""}" ${attrs}>${opts.map(([v,l])=>`<option value="${v}" ${v===value?"selected":""}>${l}</option>`).join("")}</select>`;
}

// The S/U cell: pass/fail modules can't be S/U'd, so they show a label.
function suCellHTML(m,attr){
  return m.pf?`<span class="pf-tag" title="Graded pass/fail (CS/CU); doesn't count towards GPA or S/U">P/F</span>`
    :`<button class="su-toggle ${m.su?"on":""}" ${attr} aria-pressed="${m.su?"true":"false"}">S/U</button>`;
}

function gpaViewHTML(){
  fillMissingUnits();
  const past=gpaOf(pastModules()), withNow=gpaOf([...pastModules(),...state.modules]), now=gpaOf(state.modules);
  const limit=state.gpa?.suLimit??32, used=suUnitsUsed(), usedPast=suUnitsUsed(false);
  const sug=suSuggestions();
  const cur=state.semester;
  return `${finishBannerHTML()}
    <div class="gpa-hero card">
      <div><small>Cumulative GPA</small><b>${gpaText(past.gpa)}</b><span>${past.units} graded unit${past.units===1?"":"s"}${(state.archive||[]).length?` · ${(state.archive||[]).length} semester${state.archive.length===1?"":"s"}`:""}</span></div>
      <div><small>With this semester</small><b class="${withNow.gpa!=null&&past.gpa!=null?(withNow.gpa>=past.gpa?"up":"down"):""}">${gpaText(withNow.gpa)}</b><span>projected from your expected grades</span></div>
    </div>
    <div class="card su-card">
      <div class="side-head"><h4>S/U used</h4><button class="link" id="suLimit">Limit ${limit} units</button></div>
      <div class="su-bar"><span class="past" style="width:${Math.min(100,usedPast/limit*100)}%"></span><span class="now" style="width:${Math.min(100,(used-usedPast)/limit*100)}%"></span></div>
      <p class="grade-line"><b>${used}</b> of ${limit} units${used>usedPast?` (${used-usedPast} planned this semester)`:""} · ${Math.max(0,limit-used)} left</p>
    </div>

    <h3 class="section-title">This semester <small>${esc(semesterLabel(cur.academicYear,cur.semester))}</small></h3>
    ${state.modules.length?`<div class="card flush gpa-table">
      <div class="gpa-row head"><span>Module</span><span>Units</span><span>Expected</span><span>S/U</span></div>
      ${state.modules.map((m,i)=>`<div class="gpa-row">
        <span class="gpa-mod"><b>${esc(m.code)}</b><small>${esc(m.name||moduleName(m.code))}</small></span>
        <input class="units-input" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(String(unitsOf(m)))}" data-cur-units="${i}" aria-label="Units for ${esc(m.code)}">
        ${gradeSelectHTML(m.grade||"",`data-cur-grade="${i}" aria-label="Expected grade for ${esc(m.code)}"`,m.pf)}
        ${suCellHTML(m,`data-cur-su="${i}"`)}
      </div>`).join("")}
      <div class="gpa-foot">Semester GPA <b>${gpaText(now.gpa)}</b>${now.units?` · ${now.units} units`:""}</div>
    </div>
    ${sug.length?`<div class="card su-suggest"><h4>Best modules to S/U</h4>${sug.slice(0,3).map(x=>`<button class="su-sug" data-cur-su="${state.modules.indexOf(x.m)}">
        <span><b>${esc(x.m.code)}</b> (${esc(x.m.grade)})</span><span>${gpaText(withNow.gpa)} → <b>${gpaText(x.gpa)}</b> <i>+${x.delta.toFixed(2)}</i></span></button>`).join("")}
        <p class="small-help">Based on your expected grades. Tap to mark it S/U.</p></div>`
      :state.modules.some(m=>m.grade)?"":`<p class="small-help gpa-hint">Pick an expected grade for each module to see your projected GPA and which module is best to S/U.</p>`}`
    :`<div class="empty-inline">No modules this semester yet. Add them in Settings → Modules & timetable.</div>`}

    ${planAheadHTML()}

    <h3 class="section-title">Past semesters</h3>
    ${(state.archive||[]).length?`<div class="card flush list">${[...state.archive].reverse().map(s=>{
      const g=gpaOf(s.modules||[]);
      return `<button class="list-row tap" data-go="courses/semester" data-params='${esc(JSON.stringify({id:s.id}))}'>
        <div><b>${esc(semesterLabel(s.academicYear,s.semester))}</b><small>${(s.modules||[]).length} module${(s.modules||[]).length===1?"":"s"} · ${g.units} graded units${(s.modules||[]).some(m=>!m.grade)?" · grades missing":""}</small></div>
        <span class="sem-gpa">${gpaText(g.gpa)}</span>${icon("M9 18l6-6-6-6",18)}</button>`;
    }).join("")}</div>`:`<div class="empty-inline">None yet. Finished semesters appear here.</div>`}
    <div class="syl-actions">
      <button class="btn secondary" id="addPastSem">Add a past semester</button>
      ${state.modules.length?`<button class="btn ghost" data-finish>Finish this semester</button>`:""}
    </div>`;
}

/* ---------- Plan ahead ---------- */

const planList=()=>state.gpa?.plan||[];
const letterFor=pts=>Object.entries(GRADE_POINTS).filter(([g])=>g!=="A+").sort((a,b)=>a[1]-b[1]).find(([,p])=>p>=pts-1e-9)?.[0]||"A";

function planAheadHTML(){
  const plan=planList();
  const now=gpaOf([...pastModules(),...state.modules]);
  const after=gpaOf([...pastModules(),...state.modules,...plan]);
  const planSu=plan.filter(m=>m.su).reduce((n,m)=>n+unitsOf(m),0);
  const limit=state.gpa?.suLimit??32, suLeft=limit-suUnitsUsed()-planSu;
  const target=state.gpa?.target;
  // Average grade point needed on planned (graded, non-S/U) units to reach the target.
  const open=plan.filter(m=>!m.pf&&!m.su).reduce((n,m)=>n+unitsOf(m),0);
  let need=null;
  if(target!=null&&open>0) need=(target*(now.units+open)-now.pts)/open;
  const needText=need==null?"":need<=0?`You're already there: any grades keep you at ${target.toFixed(2)} or above.`
    :need>5?`Out of reach with ${open} planned units: even straight A's give ${gpaText((now.pts+5*open)/(now.units+open))}.`
    :`You need an average of <b>${need.toFixed(2)}</b> (about <b>${letterFor(need)}</b>) across your ${open} planned graded units.`;
  return `<h3 class="section-title">Plan ahead <small>future semesters</small></h3>
    <div class="card flush gpa-table plan-table">
      ${plan.length?`<div class="gpa-row head"><span>Module</span><span>Units</span><span>Expected</span><span>S/U</span></div>
      ${plan.map((m,i)=>`<div class="gpa-row-wrap"><div class="gpa-row">
        <span class="gpa-mod"><input class="code-input" value="${esc(m.code)}" placeholder="Code" data-plan-code="${i}" autocapitalize="characters" autocomplete="off"><small>${esc(m.name||"")}</small></span>
        <input class="units-input" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(String(unitsOf(m)))}" data-plan-units="${i}" aria-label="Units">
        ${gradeSelectHTML(m.grade||"",`data-plan-grade="${i}" aria-label="Expected grade"`,m.pf)}
        ${suCellHTML(m,`data-plan-su="${i}"`)}
      </div><button class="link danger-text remove-mod" data-plan-remove="${i}">Remove</button></div>`).join("")}
      <div class="gpa-foot">After these <b>${gpaText(after.gpa)}</b>${after.gpa!=null&&now.gpa!=null?` <i class="${after.gpa>=now.gpa?"up":"down"}">${after.gpa>=now.gpa?"+":""}${(after.gpa-now.gpa).toFixed(2)}</i>`:""} · ${planSu?`${planSu} S/U units planned, `:""}${Math.max(0,suLeft)} S/U units left</div>`
      :`<div class="empty-inline">Add modules you plan to take to see where your GPA could go. Build the timetable itself in NUSMods.</div>`}
    </div>
    <div class="card plan-target">
      <div class="side-head"><h4>Target GPA</h4><button class="link" id="planTarget">${target!=null?target.toFixed(2):"Set"}</button></div>
      <p class="grade-line">${target==null?"Set the cumulative GPA you're aiming for to see the grades you need in your planned modules."
        :!open?"Add planned modules (not S/U or pass/fail) to see what you need.":needText}</p>
    </div>
    <div class="syl-actions"><button class="btn secondary" id="planAdd">+ Plan a module</button></div>`;
}

async function lookUpPlanned(m){
  try{
    const d=await getJSON(`${nusmodsBase()}/modules/${encodeURIComponent(m.code)}.json`);
    m.name=d.title||"";
    const u=parseFloat(d.moduleCredit); if(Number.isFinite(u)) m.units=u;
    m.pf=isPassFail(d);
    if(m.pf){ m.grade="CS"; m.su=false; }
  }catch{ m.name=""; }
}

function openPlanTarget(){
  openModal(`<h2>Target GPA</h2>
    <form class="form" id="targetGpaForm">
      <label>Cumulative GPA you're aiming for<input class="input" name="target" type="number" min="0" max="5" step="0.01" inputmode="decimal" value="${state.gpa?.target??""}" placeholder="e.g. 4.00"></label>
      <p class="small-help">On the NUS 5-point scale. 4.50 and above is Honours (Highest Distinction) for most degrees; check your faculty's bands.</p>
      <button class="btn primary full">Save</button>
      ${state.gpa?.target!=null?`<button type="button" class="btn ghost full" id="clearTargetGpa">Clear</button>`:""}
    </form>`);
  $("#targetGpaForm").onsubmit=e=>{
    e.preventDefault();
    const v=parseFloat(new FormData(e.target).get("target"));
    if(Number.isFinite(v)&&v>0&&v<=5){ state.gpa={...(state.gpa||{}),target:v}; save(); }
    closeModal();
  };
  $("#clearTargetGpa")?.addEventListener("click",()=>{ const g={...(state.gpa||{})}; delete g.target; state.gpa=g; save(); closeModal(); });
}

function bindPlanAhead(el){
  const plan=()=>{ if(!state.gpa) state.gpa={suLimit:32}; if(!state.gpa.plan) state.gpa.plan=[]; return state.gpa.plan; };
  $("#planAdd",el)?.addEventListener("click",()=>{
    plan().push({id:uid(),code:"",name:"",units:4,grade:"",su:false});
    save(); views.courses?.refresh?.();
    setTimeout(()=>$$("[data-plan-code]",el).at(-1)?.focus(),50);
  });
  $("#planTarget",el)?.addEventListener("click",openPlanTarget);
  $$("[data-plan-code]",el).forEach(x=>x.onchange=async()=>{
    const m=plan()[+x.dataset.planCode]; if(!m) return;
    m.code=x.value.trim().toUpperCase().replace(/\s+/g,"");
    if(m.code) await lookUpPlanned(m);
    x.blur(); save();
  });
  $$("[data-plan-units]",el).forEach(x=>x.onchange=()=>{ const v=parseFloat(x.value); if(Number.isFinite(v)&&v>=0){ plan()[+x.dataset.planUnits].units=v; save(); } });
  $$("[data-plan-grade]",el).forEach(x=>x.onchange=()=>{ plan()[+x.dataset.planGrade].grade=x.value; save(); });
  $$("[data-plan-su]",el).forEach(x=>x.onclick=()=>{ const m=plan()[+x.dataset.planSu]; m.su=!m.su; save(); });
  $$("[data-plan-remove]",el).forEach(x=>x.onclick=()=>{ plan().splice(+x.dataset.planRemove,1); save(); });
}

function bindGpaView(el){
  bindPlanAhead(el);
  $$("[data-finish]",el).forEach(b=>b.onclick=openFinishSemester);
  $$("[data-cur-grade]",el).forEach(s=>s.onchange=()=>{ state.modules[+s.dataset.curGrade].grade=s.value; save(); });
  $$("[data-cur-units]",el).forEach(inp=>inp.onchange=()=>{ const v=parseFloat(inp.value); if(Number.isFinite(v)&&v>=0){ state.modules[+inp.dataset.curUnits].units=v; save(); } });
  $$("[data-cur-su]",el).forEach(b=>b.onclick=()=>{ const m=state.modules[+b.dataset.curSu]; m.su=!m.su; save(); });
  $("#suLimit",el)?.addEventListener("click",openSuLimit);
  $("#addPastSem",el)?.addEventListener("click",openAddPastSemester);
}

function openSuLimit(){
  openModal(`<h2>S/U limit</h2>
    <form class="form" id="suForm">
      <label>Units you can S/U<input class="input" name="limit" type="number" min="0" step="1" value="${esc(String(state.gpa?.suLimit??32))}" inputmode="numeric"></label>
      <p class="small-help">Most NUS students can S/U up to 32 units. Check your faculty's rules.</p>
      <button class="btn primary full">Save</button>
    </form>`);
  $("#suForm").onsubmit=e=>{
    e.preventDefault();
    const v=parseInt(new FormData(e.target).get("limit"),10);
    if(Number.isFinite(v)&&v>=0){ state.gpa={...(state.gpa||{}),suLimit:v}; save(); }
    closeModal();
  };
}

function openAddPastSemester(){
  const [y]=String(state.semester.academicYear).split("-").map(Number);
  const years=[0,1,2,3,4,5].map(i=>`${y-i}-${y-i+1}`);
  openModal(`<h2>Add a past semester</h2>
    <form class="form" id="pastForm">
      <div class="two">
        <label>Academic year<select class="input" name="ay">${years.map((a,i)=>`<option ${i===1?"selected":""}>${a}</option>`).join("")}</select></label>
        <label>Semester<select class="input" name="sem"><option>1</option><option>2</option><option value="3">Special term</option></select></label>
      </div>
      <button class="btn primary full">Next: add modules</button>
    </form>`);
  $("#pastForm").onsubmit=e=>{
    e.preventDefault();
    const f=new FormData(e.target);
    const entry={id:uid(),academicYear:String(f.get("ay")),semester:String(f.get("sem")),archivedAt:Date.now(),manual:true,modules:[],lessons:[],syllabus:{modules:[]}};
    // Keep the list in time order.
    state.archive=[...(state.archive||[]),entry].sort((a,b)=>`${a.academicYear}${a.semester}`.localeCompare(`${b.academicYear}${b.semester}`));
    save(); closeModal();
    go("courses/semester",{id:entry.id,add:"1"});
  };
}

/* ---------- One past semester ---------- */

views["courses/semester"]=(()=>{
  let el=null, id="";
  const entry=()=>(state.archive||[]).find(s=>s.id===id);

  function moduleSyllabusHTML(s,code){
    const m=(s.syllabus?.modules||[]).find(x=>x.code===code);
    if(!m) return "";
    const scored=(m.assessments||[]).filter(a=>weightValue(a.weight)!=null);
    const g=gradeSummary(m);
    return `<details class="past-detail"><summary>Assessments${g.gradedWeight?` · ${pctText(g.earned)} of ${pctText(g.gradedWeight)} earned`:""} · outline</summary>
      ${(m.assessments||[]).map(a=>`<div class="past-assess"><span>${esc(a.title)}${weightValue(a.weight)!=null?` <i>${esc(weightLabel(a.weight))}</i>`:""}</span><span>${a.score!=null?esc(a.scoreText||pctText(a.score)):"–"}</span></div>`).join("")}
      ${(m.weeks||[]).map(w=>`<div class="past-week"><b>${esc(typeof w.week==="number"?`Week ${w.week}`:String(w.week).replace(/^./,c=>c.toUpperCase()))}</b> ${esc(w.topic||w.lecture||w.notes||"")}</div>`).join("")}
    </details>`;
  }

  function render(){
    const s=entry();
    if(!s){ el.innerHTML=`${pageHeader("Semester",{back:"courses"})}<div class="empty-inline">This semester isn't in your archive.</div>`; return; }
    const g=gpaOf(s.modules||[]);
    el.innerHTML=`${pageHeader(esc(semesterLabel(s.academicYear,s.semester)),{back:"courses",eyebrow:"Past semester"})}
      <div class="gpa-hero card single"><div><small>Semester GPA</small><b>${gpaText(g.gpa)}</b><span>${g.units} graded units · ${(s.modules||[]).filter(m=>m.su).reduce((n,m)=>n+unitsOf(m),0)} S/U units</span></div></div>
      <div class="card flush gpa-table">
        <div class="gpa-row head"><span>Module</span><span>Units</span><span>Grade</span><span>S/U</span></div>
        ${(s.modules||[]).map((m,i)=>`<div class="gpa-row-wrap">
          <div class="gpa-row">
            <span class="gpa-mod">${s.manual||m.manual?`<input class="code-input" value="${esc(m.code)}" placeholder="Code" data-code="${i}" autocapitalize="characters">`:`<b>${esc(m.code)}</b><small>${esc(m.name||"")}</small>`}</span>
            <input class="units-input" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(String(unitsOf(m)))}" data-units="${i}" aria-label="Units">
            ${gradeSelectHTML(m.grade||"",`data-grade="${i}" aria-label="Grade"`,m.pf)}
            ${suCellHTML(m,`data-su="${i}"`)}
          </div>
          ${moduleSyllabusHTML(s,m.code)}
          ${s.manual||m.manual?`<button class="link danger-text remove-mod" data-remove="${i}">Remove</button>`:""}
        </div>`).join("")||`<div class="empty-inline">No modules yet.</div>`}
      </div>
      <div class="syl-actions">
        <button class="btn secondary" id="addMod">+ Add a module</button>
        <button class="btn ghost danger-text" id="delSem">Delete this semester</button>
      </div>`;
    const changed=()=>{ save(); render(); };
    $$("[data-grade]",el).forEach(x=>x.onchange=()=>{ s.modules[+x.dataset.grade].grade=x.value; changed(); });
    $$("[data-units]",el).forEach(x=>x.onchange=()=>{ const v=parseFloat(x.value); if(Number.isFinite(v)&&v>=0){ s.modules[+x.dataset.units].units=v; changed(); } });
    $$("[data-su]",el).forEach(x=>x.onclick=()=>{ const m=s.modules[+x.dataset.su]; m.su=!m.su; changed(); });
    $$("[data-code]",el).forEach(x=>x.onchange=()=>{ s.modules[+x.dataset.code].code=x.value.trim().toUpperCase().replace(/\s+/g,""); changed(); });
    $$("[data-remove]",el).forEach(x=>x.onclick=()=>{ s.modules.splice(+x.dataset.remove,1); changed(); });
    $("#addMod",el).onclick=()=>{ s.modules.push({code:"",name:"",units:4,grade:"",su:false,manual:true}); changed(); setTimeout(()=>$$(".code-input",el).at(-1)?.focus(),0); };
    $("#delSem",el).onclick=async()=>{
      if(!await confirmSheet(`Delete ${semesterLabel(s.academicYear,s.semester)}? Its modules, grades and syllabus are removed.`,{confirm:"Delete"})) return;
      state.archive=state.archive.filter(x=>x.id!==s.id); save({immediate:true}); go("courses",{mode:"gpa"});
    };
  }

  return {
    title:"Past semester",
    mount(c){ el=c; },
    show(params){
      id=String(params.id||"");
      render();
      if(params.add && !(entry()?.modules||[]).length) $("#addMod",el)?.click();
    },
    // Don't re-render while typing in a field (data saves trigger refreshes).
    refresh(){ if(!el.contains(document.activeElement)||!/INPUT|SELECT/.test(document.activeElement.tagName)) render(); }
  };
})();
