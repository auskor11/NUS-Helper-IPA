/* Courses tab: the syllabus (app/syllabus.js) split into views you can scan.
 *   Courses:        This week · Assessments · Grades, across all modules
 *   Courses/module: one module's full Outline · Assessments · Grades
 */

function coursesMenuButton(){
  return `<button class="icon-btn" id="coursesMenu" aria-label="Syllabus options">${icon("M5 12h.01M12 12h.01M19 12h.01",22)}</button>`;
}

function openCoursesMenu(){
  const has=(state.syllabus?.modules||[]).length;
  openModal(`<h2>Syllabus</h2>
    <div class="sheet-actions">
      <button class="btn primary" data-syl="import">Import or update</button>
      <button class="btn secondary" data-syl="help">Make the file with Claude</button>
      ${has?`<button class="btn danger-soft" data-syl="clear">Remove syllabus</button>`:""}
    </div>
    <h4 class="sub-head">Semester</h4>
    <div class="sheet-actions">
      <button class="btn secondary" id="menuFinish">Finish ${esc(semesterLabel(state.semester.academicYear,state.semester.semester))}</button>
      <button class="btn ghost" id="menuPast">Add a past semester</button>
    </div>`);
  bindSyllabusActions($("#sheetContent"));
  $("#menuFinish").onclick=openFinishSemester;
  $("#menuPast").onclick=openAddPastSemester;
}

function coursesEmptyHTML(){
  return `<div class="empty-state">${icon("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM8 7h8M8 11h6",40)}
    <h3>Add your syllabus</h3>
    <p>See what each lecture and tutorial covers, every assessment, and your grades so far.</p>
    <button class="btn primary" data-syl="help">Make the file with Claude</button>
    <button class="btn ghost" data-syl="import">I have the file</button>
  </div>`;
}

// Upcoming dated assessments grouped under their academic week.
function assessmentTimelineHTML(list,{showModule=true}={}){
  const now=new Date();
  const scheduled=list.filter(a=>a.date||a.week);
  const upcoming=scheduled.filter(a=>!a.when||a.when>=now), past=scheduled.filter(a=>a.when&&a.when<now);
  const groups=[];
  for(const a of upcoming){
    const aw=a.when?academicWeek(a.when):null;
    const label=aw?.label||"Date TBC";
    if(groups.at(-1)?.label!==label) groups.push({label,items:[]});
    groups.at(-1).items.push(a);
  }
  if(!groups.length&&!past.length) return `<div class="empty-inline">No dated assessments.</div>`;
  return `${groups.map(g=>`<h4 class="week-group">${esc(g.label)}</h4>
      <div class="card flush assess-list">${g.items.map(a=>assessmentRowHTML(a,{showModule})).join("")}</div>`).join("")
    ||`<div class="empty-inline">Nothing coming up.</div>`}
    ${past.length?`<details class="card flush assess-list assess-past-card"><summary>${past.length} past</summary>${past.reverse().map(a=>assessmentRowHTML(a,{showModule})).join("")}</details>`:""}`;
}

views.courses=(()=>{
  let el=null;
  let mode=(()=>{ try{ return localStorage.getItem("nus_courses_mode")||"week"; }catch{ return "week"; } })();
  let selected=new Date();

  function setMode(m){ mode=m; try{ localStorage.setItem("nus_courses_mode",m); }catch{} render(); }

  function weekView(mods){
    const aw=academicWeek(selected);
    const start=startOfWeek(selected), end=addDays(start,6);
    const range=`${start.toLocaleDateString("en-SG",{day:"numeric",month:"short"})} – ${end.toLocaleDateString("en-SG",{day:"numeric",month:"short"})}`;
    const due=allAssessments().filter(a=>a.when&&a.when>=start&&a.when<addDays(start,7));
    return `<div class="toolbar">
        <button class="icon-btn sm" id="prevWeek" aria-label="Previous week">${icon("M15 18l-6-6 6-6",18)}</button>
        <b>${esc(aw?.label||"This week")}<small class="toolbar-sub">${esc(range)}</small></b>
        <button class="icon-btn sm" id="nextWeek" aria-label="Next week">${icon("M9 18l6-6-6-6",18)}</button>
      </div>
      <div class="courses-week">
      <aside class="cw-side">
        ${due.length?`<div class="card due-card"><h4>Assessments this week</h4>${due.map(a=>assessmentRowHTML(a)).join("")}</div>`:""}
        ${sideExtrasHTML(mods,start)}
      </aside>
      <div class="cw-main">
      ${mods.map(m=>{
        const w=syllabusWeek(m.code,selected);
        return `<button class="card syl-card tap" data-go="courses/module" data-params='${esc(JSON.stringify({code:m.code}))}'>
          <div class="syl-head"><b>${esc(m.code)}</b><small>${esc(m.title||moduleName(m.code))}</small>${icon("M9 18l6-6-6-6",18)}</div>
          ${w?`${w.topic?`<p class="syl-topic">${esc(w.topic)}</p>`:""}${syllabusLinesHTML(w)}`
            :`<p class="subtle syl-none">${aw&&aw.kind!=="teaching"?esc(aw.label):"Nothing listed this week."}</p>`}
        </button>`;
      }).join("")}
      </div></div>`;
  }

  // Wide screens only (hidden on phones): what's coming after this week, and
  // each module's grade at a glance.
  function sideExtrasHTML(mods,weekStart){
    const later=allAssessments().filter(a=>(a.date||a.week)&&a.when&&a.when>=addDays(weekStart,7)).slice(0,4);
    return `<div class="cw-extra">
      ${later.length?`<div class="card side-card"><div class="side-head"><h4>Coming up</h4><button class="link" data-mode="assess">See all</button></div>
        ${later.map(a=>assessmentRowHTML(a)).join("")}</div>`:""}
      <div class="card side-card"><div class="side-head"><h4>Grades</h4><button class="link" data-mode="grades">Details</button></div>
        ${mods.map(m=>{
          const g=gradeSummary(m), scale=Math.max(100,g.total||100);
          return `<button class="side-grade" data-go="courses/module" data-params='${esc(JSON.stringify({code:m.code,tab:"grades"}))}'>
            <span><b>${esc(m.code)}</b><small>${g.gradedWeight?`${pctText(g.earned)} of ${pctText(g.gradedWeight)}`:"No scores yet"}</small></span>
            <span class="grade-bar"><span class="earned" style="width:${g.earned/scale*100}%"></span><span class="lost" style="width:${(g.gradedWeight-g.earned)/scale*100}%"></span><span class="left" style="width:${g.remaining/scale*100}%"></span></span>
          </button>`;
        }).join("")}
      </div>
    </div>`;
  }

  function gradesView(mods){
    return mods.map(m=>{
      const g=gradeSummary(m);
      const scale=Math.max(100,g.total||100);
      return `<button class="card grade-summary tap" data-go="courses/module" data-params='${esc(JSON.stringify({code:m.code,tab:"grades"}))}'>
        <div class="syl-head"><b>${esc(m.code)}</b><small>${esc(m.title||moduleName(m.code))}</small>${icon("M9 18l6-6-6-6",18)}</div>
        ${g.comps.length?`<div class="grade-bar">
            <span class="earned" style="width:${g.earned/scale*100}%"></span>
            <span class="lost" style="width:${(g.gradedWeight-g.earned)/scale*100}%"></span>
            <span class="left" style="width:${g.remaining/scale*100}%"></span>
          </div>
          <p class="grade-line">${g.gradedWeight?`<b>${pctText(g.earned)}</b> earned of ${pctText(g.gradedWeight)} graded · ${pctText(g.remaining)} to come`:`No scores yet · ${pctText(g.total)} to come`}</p>`
          :`<p class="subtle syl-none">No weightage in the file.</p>`}
      </button>`;
    }).join("");
  }

  function render(){
    const mods=state.syllabus?.modules||[];
    const aw=academicWeek(new Date());
    el.innerHTML=`
      ${pageHeader("Courses",{
        eyebrow:`AY${esc(state.semester.academicYear)} · Sem ${esc(state.semester.semester)}${aw?` · ${esc(aw.label)}`:""}`,
        actions:coursesMenuButton()
      })}
      <div class="segmented courses-tabs">
        ${[["week","This week"],["assess","Assessments"],["grades","Grades"],["gpa","GPA"]].map(([k,l])=>`<button class="${mode===k?"on":""}" data-mode="${k}">${l}</button>`).join("")}
      </div>
      ${mode==="gpa"?gpaViewHTML()
        :!mods.length?`${finishBannerHTML()}${coursesEmptyHTML()}`
        :mode==="week"?finishBannerHTML()+weekView(mods):mode==="assess"?assessmentTimelineHTML(allAssessments()):gradesView(mods)}`;
    $("#coursesMenu",el).onclick=openCoursesMenu;
    $$("[data-mode]",el).forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
    $("#prevWeek",el)?.addEventListener("click",()=>{ selected=addDays(selected,-7); render(); });
    $("#nextWeek",el)?.addEventListener("click",()=>{ selected=addDays(selected,7); render(); });
    bindSyllabusActions(el);
    bindGpaView(el);
  }

  return {
    title:"Courses",
    mount(c){ el=c; },
    show(params){
      if(params.mode) mode=params.mode;
      selected=new Date();
      render();
    },
    // Don't re-render under the cursor while a units field is being edited.
    refresh(){ if(!el.contains(document.activeElement)||document.activeElement.tagName!=="INPUT") render(); }
  };
})();

views["courses/module"]=(()=>{
  let el=null, code="", tab="outline";

  function outlineHTML(m){
    const now=academicWeek(new Date());
    const nowKey=now?(now.week??now.kind):null;
    const byKey=new Map((m.weeks||[]).map(w=>[String(w.week),w]));
    const dueBy=new Map();
    for(const a of allAssessments().filter(a=>a.module===m.code&&a.when)){
      const aw=academicWeek(a.when); const k=aw?String(aw.week??aw.kind):"";
      if(!dueBy.has(k)) dueBy.set(k,[]); dueBy.get(k).push(a);
    }
    return OUTLINE_WEEKS.filter(k=>byKey.has(String(k))||dueBy.has(String(k))).map(k=>{
      const w=byKey.get(String(k))||{}, info=outlineWeekInfo(k), cur=String(k)===String(nowKey);
      const due=dueBy.get(String(k))||[];
      return `<div class="card outline-week ${cur?"current":""}" ${cur?`id="currentWeek"`:""}>
        <div class="outline-head"><b>${esc(info.label)}</b><small>${esc(info.range)}</small>${cur?`<span class="pill live">This week</span>`:""}</div>
        ${w.topic?`<p class="syl-topic">${esc(w.topic)}</p>`:""}
        ${syllabusLinesHTML(w)}
        ${due.map(a=>`<div class="outline-due t-${esc(a.type)}">${icon("M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",13)}${esc(a.title)}${weightValue(a.weight)!=null?` · ${esc(weightLabel(a.weight))}`:""} · ${esc(assessmentWhen(a))}</div>`).join("")}
      </div>`;
    }).join("")||`<div class="empty-inline">No weekly outline in the file.</div>`;
  }

  function assessHTML(m){
    const mine=allAssessments().filter(a=>a.module===code);
    const ongoing=(m.assessments||[]).filter(a=>!a.date&&!a.week);
    return `${assessmentTimelineHTML(mine,{showModule:false})}
      ${ongoing.length?`<h4 class="week-group">Throughout the semester</h4>
        <div class="card flush assess-list">${ongoing.map(a=>`<div class="assess-row t-${esc(a.type)}"><span class="assess-bar"></span>
          <div class="assess-main"><b>${esc(a.title)}${weightValue(a.weight)!=null?` <span class="assess-weight">${esc(weightLabel(a.weight))}</span>`:""}</b>${a.notes?`<small class="assess-notes">${esc(a.notes)}</small>`:""}</div></div>`).join("")}</div>`:""}`;
  }

  // The outline opens at the current week; the other tabs at the top.
  function jump(){
    const cur=tab==="outline"&&$("#currentWeek",el);
    if(cur) window.scrollTo(0,cur.getBoundingClientRect().top+window.scrollY-140);
    else window.scrollTo(0,0);
  }

  function render(){
    const m=syllabusModule(code);
    if(!m){ el.innerHTML=`${pageHeader(esc(code||"Module"),{back:"courses"})}<div class="empty-inline">This module isn't in your syllabus.</div>`; return; }
    el.innerHTML=`
      ${pageHeader(esc(m.code),{back:"courses",eyebrow:esc(m.title||moduleName(m.code))})}
      <div class="segmented">
        ${[["outline","Outline"],["assess","Assessments"],["grades","Grades"]].map(([k,l])=>`<button class="${tab===k?"on":""}" data-tab-mode="${k}">${l}</button>`).join("")}
      </div>
      ${tab==="outline"?outlineHTML(m):tab==="assess"?assessHTML(m):gradeCardHTML(m,{title:"Overall"})}`;
    $$("[data-tab-mode]",el).forEach(b=>b.onclick=()=>{ tab=b.dataset.tabMode; render(); jump(); });
    bindSyllabusActions(el);
  }

  return {
    title:"Module",
    mount(c){ el=c; },
    show(params){
      code=String(params.code||"").toUpperCase();
      tab=params.tab||"outline";
      render();
      setTimeout(jump,0);
    },
    refresh(){ render(); }
  };
})();
