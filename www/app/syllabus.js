/* Syllabus: what each module covers week by week, and its assessments.
 * The file is made by Claude from the module's lesson plan (the prompt is in
 * syllabusPrompt) and imported here. Shown as the Schedule tab's Syllabus
 * view and as the topic line on lessons in the Day view. Assessments with a
 * date are also added to Tasks so they get reminders.
 */

const SYLLABUS_FORMAT="nus-companion-syllabus";
const ASSESSMENT_TYPES=["exam","quiz","assignment","project","presentation","lab","other"];

function syllabusModule(code){
  return (state.syllabus?.modules||[]).find(m=>m.code===code)||null;
}

// The syllabus entry for a module in the academic week containing `date`.
function syllabusWeek(code,date){
  const mod=syllabusModule(code), aw=academicWeek(date);
  if(!mod||!aw) return null;
  const key=aw.week ?? aw.kind;
  return (mod.weeks||[]).find(w=>String(w.week)===String(key))||null;
}

// What a lesson covers on a date: the lecture topic for lectures, the
// tutorial topic for tutorials and so on, else the week's topic.
function lessonTopic(lesson,date){
  const w=syllabusWeek(lesson.module,date);
  if(!w) return "";
  const t=String(lesson.lessonType||"").toLowerCase();
  const pick=t.startsWith("lec")||t.includes("lecture") ? w.lecture
    : t.startsWith("tut")||t.startsWith("rec") ? w.tutorial
    : t.startsWith("lab") ? w.lab : "";
  return pick||w.topic||"";
}

// Every assessment, soonest first; ones without a date sort by week.
function allAssessments(){
  const start=semesterStart();
  const rows=[];
  for(const m of state.syllabus?.modules||[]){
    for(const a of m.assessments||[]){
      let when=a.date?new Date(`${a.date}T${a.time||"23:59"}:00`):null;
      if(!when && start && typeof a.week==="number"){
        const i=a.week<=6?a.week-1:a.week; // week 7 starts after recess
        when=addDays(start,i*7+4); when.setHours(23,59,0,0); // that week's Friday
      }
      rows.push({...a,module:m.code,when});
    }
  }
  return rows.sort((a,b)=>(a.when?.getTime()??Infinity)-(b.when?.getTime()??Infinity));
}

/* ---------- Prompt for Claude ---------- */

function syllabusPrompt(){
  const start=semesterStart();
  const day=n=>start?addDays(start,n).toLocaleDateString("en-SG",{weekday:"short",day:"numeric",month:"short",year:"numeric"}):"";
  const calendar=start?`- AY${state.semester.academicYear} Semester ${state.semester.semester}: Week 1 starts ${day(0)}. Weeks 1–6, then Recess week (${day(42)} – ${day(48)}), Week 7 starts ${day(49)}, Week 13 ends ${day(97)}, Reading week ${day(98)} – ${day(104)}, exams ${day(105)} – ${day(118)}.\n`:"";
  const codes=state.modules.map(m=>m.code).join(", ");
  return `I've attached the semester outline PDFs for my NUS modules (one per module). Read every PDF, including any tables of weekly topics and assessment breakdowns, and turn them into one JSON file for my NUS Companion app. Give me the file to download as syllabus.json.

If an outline has no weekly schedule, still include its assessments. If a PDF is unreadable or isn't a module outline, tell me which one instead of guessing.

Use exactly this shape:
{
  "format": "${SYLLABUS_FORMAT}",
  "version": 1,
  "academicYear": "${state.semester.academicYear}",
  "semester": ${Number(state.semester.semester)||1},
  "modules": [
    {
      "code": "CS2040S",
      "title": "Data Structures and Algorithms",
      "weeks": [
        { "week": 1, "topic": "Introduction, sorting", "lecture": "Asymptotic analysis; sorting", "tutorial": "No tutorial", "lab": "Lab 0: setup", "readings": "CLRS ch. 2", "notes": "" }
      ],
      "assessments": [
        { "title": "Midterm test", "type": "exam", "date": "2026-10-03", "time": "10:00", "endTime": "11:30", "week": 7, "weight": "20%", "venue": "MPSH 1", "notes": "Closed book, one A4 cheat sheet" }
      ]
    }
  ]
}

Rules:
- "week" is the NUS teaching week number (1–13), or "recess", "reading" or "exam".
${calendar}- Dates are YYYY-MM-DD and times are 24-hour HH:MM (Singapore time). If a source gives only a week for an assessment, set "week" and leave out "date"; work out the date from the calendar above only when the source gives the day.
- "type" is one of: ${ASSESSMENT_TYPES.join(", ")}.
- Keep each text short (one line). Leave out any field the source doesn't say; don't guess.
- One entry per module code, with every week that has content and every graded component (assignments, quizzes, tests, projects, the final exam).${codes?`\n- My modules this semester: ${codes}.`:""}`;
}

/* ---------- Import ---------- */

function parseSyllabus(text){
  let data;
  try{ data=JSON.parse(String(text||"").trim().replace(/^```(?:json)?\s*|\s*```$/g,"")); }
  catch{ throw new Error("That isn't valid JSON. Use the file Claude made, or paste its whole contents."); }
  const list=Array.isArray(data)?data:data?.modules;
  if(!Array.isArray(list)||!list.length) throw new Error("No modules were found in the file.");
  const str=v=>v==null?"":String(v).trim();
  const weekKey=v=>{
    const n=parseInt(v,10);
    if(Number.isFinite(n)&&n>=1&&n<=13) return n;
    const s=str(v).toLowerCase();
    return ["recess","reading","exam"].find(k=>s.startsWith(k))||null;
  };
  const modules=list.map(m=>{
    const code=str(m.code||m.moduleCode).toUpperCase().replace(/\s+/g,"");
    if(!code) return null;
    const weeks=(m.weeks||[]).map(w=>({
      week:weekKey(w.week),
      topic:str(w.topic), lecture:str(w.lecture), tutorial:str(w.tutorial), lab:str(w.lab),
      readings:str(w.readings), notes:str(w.notes)
    })).filter(w=>w.week!=null && (w.topic||w.lecture||w.tutorial||w.lab||w.readings||w.notes));
    const assessments=(m.assessments||[]).map(a=>({
      title:str(a.title||a.name),
      type:ASSESSMENT_TYPES.includes(str(a.type).toLowerCase())?str(a.type).toLowerCase():"other",
      date:/^\d{4}-\d{2}-\d{2}$/.test(str(a.date))?str(a.date):"",
      time:/^\d{1,2}:\d{2}$/.test(str(a.time))?minutesToInput(timeToMinutes(str(a.time))):"",
      endTime:/^\d{1,2}:\d{2}$/.test(str(a.endTime))?minutesToInput(timeToMinutes(str(a.endTime))):"",
      week:typeof weekKey(a.week)==="number"?weekKey(a.week):null,
      weight:str(a.weight), venue:str(a.venue), notes:str(a.notes)
    })).filter(a=>a.title);
    return {code,title:str(m.title||m.name),weeks,assessments};
  }).filter(Boolean);
  if(!modules.length) throw new Error("No modules with a code were found in the file.");
  return modules;
}

// Replaces the syllabus of the modules in the file and keeps the others.
// With addTasks, dated assessments become tasks (kept in step on re-import).
function importSyllabus(modules,{addTasks=true}={}){
  const codes=new Set(modules.map(m=>m.code));
  state.syllabus={modules:[...(state.syllabus?.modules||[]).filter(m=>!codes.has(m.code)),...modules]
    .sort((a,b)=>a.code.localeCompare(b.code)),importedAt:Date.now()};
  let tasks=0;
  if(addTasks){
    const done=new Map(state.tasks.filter(t=>t.source==="syllabus").map(t=>[t.id,t.done]));
    state.tasks=state.tasks.filter(t=>!(t.source==="syllabus"&&codes.has(t.module)));
    for(const m of modules){
      for(const a of m.assessments.filter(a=>a.date)){
        const id=`syl-${m.code}-${a.title.toLowerCase().replace(/[^a-z0-9]+/g,"-")}-${a.date}`;
        // Past ones arrive done so they don't show up as overdue.
        const past=new Date(`${a.date}T${a.time||"23:59"}:00`)<new Date();
        state.tasks.push({id,source:"syllabus",done:done.has(id)?done.get(id):past,module:m.code,
          title:a.weight?`${a.title} (${a.weight})`:a.title,dueDate:a.date,dueTime:a.time||""});
        tasks++;
      }
    }
  }
  return {modules:modules.length,weeks:modules.reduce((n,m)=>n+m.weeks.length,0),
    assessments:modules.reduce((n,m)=>n+m.assessments.length,0),tasks};
}

function openSyllabusImporter(){
  openModal(`<h2>Import syllabus</h2>
    <p class="subtle">Choose the <b>syllabus.json</b> file Claude made, or paste its contents.</p>
    <label class="btn secondary full file-btn">${icon("M12 15V3M7 8l5-5 5 5M5 21h14",18)}Choose file<input type="file" id="sylFile" accept=".json,application/json,text/plain" hidden></label>
    <textarea class="input" id="sylText" rows="5" placeholder='{"format":"nus-companion-syllabus", …}'></textarea>
    <label class="check-row"><input type="checkbox" id="sylTasks" checked> Add assessments with dates to Tasks</label>
    <div id="sylError"></div>
    <button class="btn primary full" id="sylImport">Import</button>
    <p class="small-help">Modules in the file replace the same modules' syllabus. Others are kept.</p>`);
  $("#sylFile").onchange=async e=>{
    const f=e.target.files?.[0];
    if(f){ $("#sylText").value=await f.text(); $("#sylImport").click(); }
  };
  $("#sylImport").onclick=()=>{
    let modules;
    try{ modules=parseSyllabus($("#sylText").value); }
    catch(err){ $("#sylError").innerHTML=`<div class="error-box">${esc(err.message)}</div>`; return; }
    const r=importSyllabus(modules,{addTasks:$("#sylTasks").checked});
    save({immediate:true});
    openModal(`<div class="success-hero">${icon("M20 6 9 17l-5-5",36)}</div><h2>Syllabus imported</h2>
      <p class="subtle">${r.modules} module${r.modules===1?"":"s"} · ${r.weeks} weeks of topics · ${r.assessments} assessment${r.assessments===1?"":"s"}${r.tasks?` · ${r.tasks} added to Tasks`:""}</p>
      <button class="btn primary full" id="sylDone">See this week</button>`);
    $("#sylDone").onclick=()=>{ closeModal(); go("schedule",{mode:"syllabus"}); };
  };
}

function openSyllabusHelp(){
  const prompt=syllabusPrompt();
  openModal(`<h2>Make your syllabus file</h2>
    <ol class="steps">
      <li>Copy the prompt below</li>
      <li>In a new Claude chat, paste it and attach your modules' <b>semester outline PDFs</b> (the + or paperclip button). Attach them all at once, or one module per chat</li>
      <li>Download the <b>syllabus.json</b> Claude makes. On iPhone, tap the file, then Share → Save to Files</li>
      <li>Come back and tap <b>Import or update</b> → Choose file</li>
    </ol>
    <p class="small-help">Doing one module at a time is fine: importing a file only replaces the modules in it. If a module's outline changes, make a new file for just that module and import it.</p>
    <button class="btn primary full" id="copyPrompt">${icon("M8 8h12v12H8zM4 16V4h12",18)}Copy prompt</button>
    <pre class="prompt-box">${esc(prompt)}</pre>`,{wide:true});
  $("#copyPrompt").onclick=async()=>{
    try{ await navigator.clipboard.writeText(prompt); toast("Prompt copied"); }
    catch{ toast("Couldn't copy. Select the text and copy it instead."); }
  };
}

/* ---------- View (Schedule → Syllabus) ---------- */

function assessmentWhen(a){
  if(a.date){
    const d=new Date(`${a.date}T12:00:00`);
    const day=d.toLocaleDateString("en-SG",{weekday:"short",day:"numeric",month:"short"});
    return `${day}${a.time?`, ${inputTimeToLabel(a.time)}${a.endTime?`–${inputTimeToLabel(a.endTime)}`:""}`:""}`;
  }
  return a.week?`Week ${a.week} (date TBC)`:"Date TBC";
}

function assessmentRowHTML(a,{showModule=true}={}){
  const now=new Date(), past=a.when&&a.when<now;
  const days=a.when?Math.ceil((new Date(a.when).setHours(0,0,0,0)-new Date().setHours(0,0,0,0))/86400000):null;
  const countdown=past?"Done":days==null?"":days===0?"Today":days===1?"Tomorrow":`In ${days} days`;
  return `<div class="assess-row t-${esc(a.type)} ${past?"past":""}">
    <span class="assess-bar"></span>
    <div class="assess-main">
      <b>${showModule?`<span class="mod-tag">${esc(a.module)}</span>`:""}${esc(a.title)}${a.weight?` <span class="assess-weight">${esc(a.weight)}</span>`:""}</b>
      <small>${esc(assessmentWhen(a))}${a.venue?` · ${esc(a.venue)}`:""}</small>
      ${a.notes?`<small class="assess-notes">${esc(a.notes)}</small>`:""}
    </div>
    ${countdown?`<span class="assess-count ${days!=null&&days>=0&&days<=7&&!past?"soon":""}">${countdown}</span>`:""}
  </div>`;
}

function syllabusViewHTML(date){
  const aw=academicWeek(date);
  const mods=state.syllabus?.modules||[];
  const start=startOfWeek(date), end=addDays(start,6);
  const range=`${start.toLocaleDateString("en-SG",{day:"numeric",month:"short"})} – ${end.toLocaleDateString("en-SG",{day:"numeric",month:"short"})}`;
  const toolbar=`<div class="toolbar">
      <button class="icon-btn sm" id="prevWeek" aria-label="Previous week">${icon("M15 18l-6-6 6-6",18)}</button>
      <b>${esc(aw?.label||"This week")}<small class="toolbar-sub">${esc(range)}</small></b>
      <button class="icon-btn sm" id="nextWeek" aria-label="Next week">${icon("M9 18l6-6-6-6",18)}</button>
    </div>`;
  if(!mods.length){
    return `${toolbar}<div class="empty-state">${icon("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM8 7h8M8 11h6",40)}
      <h3>Add your syllabus</h3>
      <p>See what each lecture and tutorial covers this week, and keep track of every assessment.</p>
      <button class="btn primary" id="sylHelp">Make the file with Claude</button>
      <button class="btn ghost" id="sylImportBtn">I have the file</button>
    </div>`;
  }
  const weekEnd=addDays(start,7);
  const all=allAssessments();
  const thisWeek=all.filter(a=>a.when&&a.when>=start&&a.when<weekEnd);
  const cards=mods.map(m=>{
    const key=aw?(aw.week??aw.kind):null;
    const w=(m.weeks||[]).find(x=>String(x.week)===String(key));
    const due=thisWeek.filter(a=>a.module===m.code);
    const line=(label,text)=>text?`<div class="syl-line"><span>${label}</span><p>${esc(text)}</p></div>`:"";
    const body=w?[line("Topic",w.topic),line("Lecture",w.lecture),line("Tutorial",w.tutorial),line("Lab",w.lab),line("Readings",w.readings),line("Notes",w.notes)].join("")
      :`<p class="subtle syl-none">${aw&&aw.kind!=="teaching"?esc(aw.label):"Nothing listed this week."}</p>`;
    return `<div class="card syl-card">
      <div class="syl-head"><b>${esc(m.code)}</b><small>${esc(m.title||moduleName(m.code))}</small></div>
      ${body}
      ${due.length?`<h4 class="sub-head">Due this week</h4>${due.map(a=>assessmentRowHTML(a,{showModule:false})).join("")}`:""}
    </div>`;
  }).join("");
  const now=new Date();
  const upcoming=all.filter(a=>!a.when||a.when>=now), past=all.filter(a=>a.when&&a.when<now);
  return `${toolbar}${cards}
    <h3 class="section-title">Assessments</h3>
    <div class="card flush assess-list">${upcoming.length?upcoming.map(a=>assessmentRowHTML(a)).join(""):`<div class="empty-inline">No upcoming assessments.</div>`}
      ${past.length?`<details class="assess-past"><summary>${past.length} past</summary>${past.reverse().map(a=>assessmentRowHTML(a)).join("")}</details>`:""}
    </div>
    <div class="syl-actions">
      <button class="btn secondary" id="sylImportBtn">Import or update</button>
      <button class="btn ghost" id="sylHelp">Make the file with Claude</button>
      <button class="btn ghost danger-text" id="sylClear">Remove syllabus</button>
    </div>`;
}

function bindSyllabusView(el){
  $("#sylHelp",el)?.addEventListener("click",openSyllabusHelp);
  $("#sylImportBtn",el)?.addEventListener("click",openSyllabusImporter);
  $("#sylClear",el)?.addEventListener("click",async()=>{
    if(!await confirmSheet("Remove the syllabus? Assessments it added to Tasks are removed too.",{confirm:"Remove"})) return;
    state.syllabus={modules:[]};
    state.tasks=state.tasks.filter(t=>t.source!=="syllabus");
    save({immediate:true}); toast("Syllabus removed");
  });
}
