/* Syllabus: what each module covers week by week, and its assessments.
 * The file is made by Claude from the module's lesson plan (the prompt is in
 * syllabusPrompt) and imported here. Shown in the Courses tab (app/courses.js)
 * and as the topic line on lessons in the Day view. Assessments are kept
 * separate from tasks; dated ones appear on the Schedule calendar.
 */

const SYLLABUS_FORMAT="nus-companion-syllabus";
const ASSESSMENT_TYPES=["exam","quiz","assignment","project","presentation","lab","other"];

// Weights are percentages of the final grade. Older files gave "20%".
function weightValue(v){
  const n=parseFloat(String(v??"").replace(/[^0-9.]/g,""));
  return Number.isFinite(n)&&n>0&&n<=100 ? n : null;
}
function weightLabel(w){ const n=weightValue(w); return n==null?"":`${+n.toFixed(2)}%`; }

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
    : t.startsWith("rec") ? w.recitation||w.tutorial
    : t.startsWith("tut") ? w.tutorial
    : t.startsWith("lab") ? w.lab : "";
  const text=pick||w.topic||"";
  // "Wed: L9A Environment Model · Fri: L9B Lists and Loops II" -> the part for this day.
  const day=new Date(date).toLocaleDateString("en-US",{weekday:"short"});
  const part=text.split(" · ").find(p=>p.startsWith(`${day}:`));
  return part ? part.slice(day.length+1).trim() : text;
}

// Every assessment, soonest first; ones without a date sort by week.
function allAssessments(){
  const start=semesterStart();
  const rows=[];
  for(const m of state.syllabus?.modules||[]){
    for(const [index,a] of (m.assessments||[]).entries()){
      let when=a.date?new Date(`${a.date}T${a.time||"23:59"}:00`):null;
      if(!when && start && typeof a.week==="number"){
        const i=a.week<=6?a.week-1:a.week; // week 7 starts after recess
        when=addDays(start,i*7+4); when.setHours(23,59,0,0); // that week's Friday
      }
      rows.push({...a,module:m.code,when,index});
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
  return `I've attached the course materials for my NUS modules. They can be any mix of file types: PDFs (including scanned ones), screenshots or photos, lecture slides (PowerPoint, Keynote or Google Slides), Word documents, or text I paste. One module's information may be spread across several files, for example a schedule screenshot plus a slide with the assessment breakdown, and one file may cover several modules.

Read every file and image fully, including tables, slide notes and small print. Work out which module each one belongs to from its content (module code or title), combine everything for the same module, and turn it all into one JSON file for my NUS Companion app. Give me the file to download as syllabus.json.

Then list, under the file: each module and which files you used for it, anything that contradicted itself across files (say which you chose), any file you couldn't read or that isn't course material, and any module whose weights don't add up to 100%. If you can't open a file type (for example .pptx), ask me to export it as PDF instead of guessing.

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
        { "week": 1, "topic": "Introduction, sorting", "lecture": "Asymptotic analysis; sorting", "tutorial": "No tutorial", "recitation": "R1: Sorting", "lab": "Lab 0: setup", "readings": "CLRS ch. 2", "notes": "" }
      ],
      "assessments": [
        { "title": "Midterm test", "type": "exam", "date": "2026-10-03", "time": "10:00", "endTime": "11:30", "week": 7, "weight": 20, "venue": "MPSH 1", "notes": "Closed book, one A4 cheat sheet" },
        { "title": "Problem sets (best 8 of 9)", "type": "assignment", "weight": 24, "notes": "3% each, due Sundays 23:59" },
        { "title": "Tutorial participation", "type": "other", "weight": 5 },
        { "title": "Reading Assessment 1", "type": "exam", "date": "2026-09-04", "weight": 8, "group": "Reading & programming assessments", "best": 3 }
      ]
    }
  ]
}

Rules:
- "week" is the NUS teaching week number (1–13), or "recess", "reading" or "exam".
${calendar}- Dates are YYYY-MM-DD and times are 24-hour HH:MM (Singapore time). If a source gives only a week for an assessment, set "week" and leave out "date"; work out the date from the calendar above only when the source gives the day.
- "weight" is the percentage of the final grade as a plain number (20, not "20%"). Include every graded component, including ones without a date such as participation or attendance, so the weights add up to 100. When a group of similar items has dates (e.g. Lab 1 to Lab 10), list each with its own weight; otherwise give the group as one entry with its total weight and explain the rule in "notes".
- "Best N of M" rules: give each item its own weight, the same "group" name and "best": N (e.g. 4 quizzes at 8% each, best 3 count). Weights then add up to 100 once only the best N of each group are counted.
- "lecture", "tutorial", "recitation" and "lab" match NUSMods lesson types. If a module names them differently (e.g. Studio is the tutorial, Reflection is the recitation), use the closest field and keep the module's own name in the text. If there are two lectures a week, put both in "lecture", e.g. "Wed: L9A Environment Model · Fri: L9B Lists and Loops II".
- "type" is one of: ${ASSESSMENT_TYPES.join(", ")}.
- For anything done in a window rather than at a set time (online quizzes, assignments, projects), give the deadline as "date" and "time" and when it opens as "opens" (YYYY-MM-DD or YYYY-MM-DDTHH:MM), if the sources say.
- Keep each text short (one line). Leave out any field the sources don't say; don't guess.
- One entry per module code, with every week that has content. Only include modules you were given materials for; leave out any module with no materials (don't add empty entries).${codes?`\n- For reference, my modules this semester are: ${codes}.`:""}`;
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
      topic:str(w.topic), lecture:str(w.lecture), tutorial:str(w.tutorial), recitation:str(w.recitation), lab:str(w.lab),
      readings:str(w.readings), notes:str(w.notes)
    })).filter(w=>w.week!=null && (w.topic||w.lecture||w.tutorial||w.recitation||w.lab||w.readings||w.notes));
    const assessments=(m.assessments||[]).map(a=>({
      title:str(a.title||a.name),
      type:ASSESSMENT_TYPES.includes(str(a.type).toLowerCase())?str(a.type).toLowerCase():"other",
      date:/^\d{4}-\d{2}-\d{2}$/.test(str(a.date))?str(a.date):"",
      time:/^\d{1,2}:\d{2}$/.test(str(a.time))?minutesToInput(timeToMinutes(str(a.time))):"",
      endTime:/^\d{1,2}:\d{2}$/.test(str(a.endTime))?minutesToInput(timeToMinutes(str(a.endTime))):"",
      week:typeof weekKey(a.week)==="number"?weekKey(a.week):null,
      weight:weightValue(a.weight), venue:str(a.venue), notes:str(a.notes),
      // "Best 3 of 4" style groups: items sharing a group, of which `best` count.
      group:str(a.group), best:parseInt(a.best,10)>0?parseInt(a.best,10):null
    })).filter(a=>a.title);
    return {code,title:str(m.title||m.name),weeks,assessments};
  }).filter(Boolean);
  // A module with no weeks and no assessments would wipe what's already
  // imported for it, so it's skipped.
  const filled=modules.filter(m=>m.weeks.length||m.assessments.length);
  if(!filled.length) throw new Error("The file has no weekly topics or assessments for any module.");
  return filled;
}

// Replaces the syllabus of the modules in the file and keeps the others.
function importSyllabus(modules){
  const codes=new Set(modules.map(m=>m.code));
  // Scores you've entered survive a re-import of the same module.
  const key=(code,title)=>`${code}|${title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}`;
  const scores=new Map();
  const examVenues=new Map(), targets=new Map();
  for(const m of state.syllabus?.modules||[]) if(m.target!=null) targets.set(m.code,m.target);
  for(const m of modules) if(targets.has(m.code)&&m.target==null) m.target=targets.get(m.code);
  for(const m of state.syllabus?.modules||[]) for(const a of m.assessments||[]){
    if(a.score!=null) scores.set(key(m.code,a.title),{score:a.score,scoreText:a.scoreText});
    // Ticks and "Show in Tasks" choices survive a re-import too.
    if(a.done!=null||a.task!=null) scores.set(key(m.code,a.title),{...scores.get(key(m.code,a.title)),...(a.done!=null?{done:a.done}:{}),...(a.task!=null?{task:a.task}:{})});
    if(a.official&&a.venue) examVenues.set(m.code,a.venue);
  }
  for(const m of modules) for(const a of m.assessments) Object.assign(a,scores.get(key(m.code,a.title))||{});
  markPastAssessmentsDone(modules);
  state.syllabus={modules:[...(state.syllabus?.modules||[]).filter(m=>!codes.has(m.code)),...modules]
    .sort((a,b)=>a.code.localeCompare(b.code)),importedAt:Date.now(),assessTasksAt:Date.now()};
  // Put the official exam times (app/exams.js) and your exam venues back.
  refreshExams({force:true}).then(()=>{
    let changed=false;
    for(const [code,venue] of examVenues){ const a=(syllabusModule(code)?.assessments||[]).find(x=>x.official); if(a&&!a.venue){ a.venue=venue; changed=true; } }
    if(changed) save().catch(()=>{});
  });
  return {modules:modules.length,weeks:modules.reduce((n,m)=>n+m.weeks.length,0),
    assessments:modules.reduce((n,m)=>n+m.assessments.length,0)};
}

function openSyllabusImporter(){
  openModal(`<h2>Import syllabus</h2>
    <p class="subtle">Choose the <b>syllabus.json</b> file Claude made, or paste its contents.</p>
    <label class="btn secondary full file-btn">${icon("M12 15V3M7 8l5-5 5 5M5 21h14",18)}Choose file<input type="file" id="sylFile" accept=".json,application/json,text/plain" hidden></label>
    <textarea class="input" id="sylText" rows="5" placeholder='{"format":"nus-companion-syllabus", …}'></textarea>
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
    const r=importSyllabus(modules);
    save({immediate:true});
    openModal(`<div class="success-hero">${icon("M20 6 9 17l-5-5",36)}</div><h2>Syllabus imported</h2>
      <p class="subtle">${r.modules} module${r.modules===1?"":"s"} · ${r.weeks} weeks of topics · ${r.assessments} assessment${r.assessments===1?"":"s"}</p>
      <button class="btn primary full" id="sylDone">See this week</button>`);
    $("#sylDone").onclick=()=>{ closeModal(); go("courses"); };
  };
}

function openSyllabusHelp(){
  const prompt=syllabusPrompt();
  openModal(`<h2>Make your syllabus file</h2>
    <ol class="steps">
      <li>Copy the prompt below</li>
      <li>In a new Claude chat, paste it and attach your modules' course materials with the + or paperclip button: outline PDFs, screenshots, slides or Word files, in any mix. Attach everything at once, or one module per chat</li>
      <li>Download the <b>syllabus.json</b> Claude makes. On iPhone, tap the file, then Share → Save to Files</li>
      <li>Come back to <b>Courses</b>, tap the ⋯ button → <b>Import or update</b> → Choose file</li>
    </ol>
    <p class="small-help">One file can hold all your modules, or you can do one module at a time: importing only replaces the modules in the file, and keeps any scores you've entered. If Claude can't open a file (some .pptx), export it as PDF and attach that instead.</p>
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
  const tick=isTaskAssessment(a);
  return `<div class="assess-row t-${esc(a.type)} ${past&&!tick?"past":""} ${tick&&assessmentDone(a)?"done":""}" data-assess-open="${esc(a.module)}|${a.index}">
    ${tick?`<button class="check ${assessmentDone(a)?"on":""}" data-assess-toggle="${esc(a.module)}|${a.index}" aria-label="${assessmentDone(a)?"Mark not done":"Mark done"}: ${esc(a.title)}"></button>`:`<span class="assess-bar"></span>`}
    <div class="assess-main">
      <b>${showModule?`<span class="mod-tag">${esc(a.module)}</span>`:""}${esc(a.title)}${weightValue(a.weight)!=null?` <span class="assess-weight">${esc(weightLabel(a.weight))}</span>`:""}</b>
      <small>${esc(assessmentWhen(a))}${a.venue?` · ${esc(a.venue)}`:""}</small>
      ${a.notes?`<small class="assess-notes">${esc(a.notes)}</small>`:""}
    </div>
    ${tick&&assessmentDone(a)?`<span class="assess-count">Done</span>`:countdown?`<span class="assess-count ${days!=null&&days>=0&&days<=7&&!past?"soon":""}">${tick&&past?"Overdue":countdown}</span>`:""}
  </div>`;
}

// The weeks of a semester in order, for module outlines.
const OUTLINE_WEEKS=[1,2,3,4,5,6,"recess",7,8,9,10,11,12,13,"reading","exam"];

// {label:"Week 3", range:"24 – 30 Aug", start} for a syllabus week key.
function outlineWeekInfo(key){
  const start=semesterStart();
  const idx=typeof key==="number"?(key<=6?key-1:key):{recess:6,reading:14,exam:15}[key];
  const label=typeof key==="number"?`Week ${key}`:{recess:"Recess week",reading:"Reading week",exam:"Exams"}[key];
  if(!start||idx==null) return {label,range:"",start:null};
  const from=addDays(start,idx*7), to=addDays(from,key==="exam"?13:6);
  const f=d=>d.toLocaleDateString("en-SG",{day:"numeric",month:"short"});
  return {label,range:`${f(from)} – ${f(to)}`,start:from};
}

function syllabusLinesHTML(w){
  const line=(label,text)=>text?`<div class="syl-line"><span>${label}</span><p>${esc(text)}</p></div>`:"";
  return [line("Lecture",w.lecture),line("Tutorial",w.tutorial),line("Recitation",w.recitation),line("Lab",w.lab),line("Readings",w.readings),line("Notes",w.notes)].join("");
}

/* ---------- One assessment ---------- */

// Ticks an assessment you do yourself on or off (also from the Tasks tab).
function toggleAssessmentDone(code,i){
  const m=syllabusModule(code), a=m?.assessments?.[i];
  if(!a) return;
  a.done=!assessmentDone(a);
  save();
  if(a.done&&weightValue(a.weight)!=null&&a.score==null) toast("Done ✓",{action:{label:"Add score",run:()=>openScoreSheet(code,i)}});
  else toast(a.done?"Done ✓":"Marked not done");
}

function openAssessmentSheet(code,i){
  const m=syllabusModule(code), a=m?.assessments?.[i];
  if(!a) return;
  const tick=isTaskAssessment(a), opens=assessmentOpens(a), w=weightValue(a.weight);
  openModal(`<p class="kicker">${esc(code)}${w!=null?` · ${esc(weightLabel(a.weight))} OF FINAL GRADE`:""}</p><h2>${esc(a.title)}</h2>
    <div class="assess-facts">
      ${opens?`<div><span>Opens</span><b>${esc(opens.toLocaleDateString("en-SG",{weekday:"short",day:"numeric",month:"short"}))}, ${esc(clockTime(opens))}</b></div>`:""}
      <div><span>${tick?"Due":"When"}</span><b>${esc(assessmentWhen(a))}</b></div>
      ${a.venue?`<div><span>Venue</span><b>${esc(a.venue)}</b></div>`:""}
      ${a.score!=null?`<div><span>Score</span><b>${esc(a.scoreText||pctText(a.score))}</b></div>`:""}
    </div>
    ${a.notes?`<p class="subtle">${esc(a.notes)}</p>`:""}
    ${a.date?`<label class="switch-row"><span><b>Show in Tasks</b><small>Tick it off when you've done it. Reminders stop once it's done.</small></span>
      <input type="checkbox" id="assessTrack" ${tick?"checked":""}></label>`:""}
    <div class="sheet-actions">
      ${tick?`<button class="btn ${assessmentDone(a)?"secondary":"primary"} full" id="assessDone">${assessmentDone(a)?"Mark not done":"Mark done"}</button>`:""}
      ${w!=null?`<button class="btn secondary full" id="assessScore">${a.score!=null?"Edit score":"Add score"}</button>`:""}
    </div>`);
  $("#assessTrack")?.addEventListener("change",e=>{
    a.task=e.target.checked;
    save(); closeModal(); toast(a.task?"Added to Tasks":"Removed from Tasks");
  });
  $("#assessDone")?.addEventListener("click",()=>{ closeModal(); toggleAssessmentDone(code,i); });
  $("#assessScore")?.addEventListener("click",()=>{ closeModal(); setTimeout(()=>openScoreSheet(code,i),50); });
}

/* ---------- Grades ---------- */
// Each module's graded components with their weights, and the scores you
// enter: what you've earned so far and how much of the grade is still to come.

function gradeSummary(m){
  const comps=(m.assessments||[]).filter(a=>weightValue(a.weight)!=null);
  // Items in a "best N" group count only N times; ungrouped items are their own group.
  const groups=new Map();
  comps.forEach((a,i)=>{ const k=a.group&&a.best?`g:${a.group}`:`i:${i}`; if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(a); });
  let total=0, gradedWeight=0, earned=0;
  for(const items of groups.values()){
    const best=Math.min(items[0].best||items.length,items.length);
    const weights=items.map(a=>weightValue(a.weight)).sort((x,y)=>y-x);
    const counted=weights.slice(0,best).reduce((n,w)=>n+w,0);
    const marks=items.filter(a=>a.score!=null).map(a=>({w:weightValue(a.weight),got:weightValue(a.weight)*a.score/100}))
      .sort((x,y)=>y.got-x.got).slice(0,best);
    total+=counted;
    // Once N items are graded the group is settled; before that, the rest is still to come.
    const g=marks.length>=best?counted:marks.reduce((n,x)=>n+x.w,0);
    gradedWeight+=g;
    earned+=marks.reduce((n,x)=>n+x.got,0);
  }
  return {comps,total,gradedWeight,earned,remaining:Math.max(0,total-gradedWeight)};
}

const pctText=n=>`${+n.toFixed(1)}%`;

function gradeCardHTML(m,{title=m.code}={}){
  const g=gradeSummary(m);
  if(!g.comps.length) return `<div class="card grade-card"><div class="syl-head"><b>${esc(m.code)}</b></div><p class="subtle syl-none">No weightage in the file.</p></div>`;
  const scale=Math.max(100,g.total);
  return `<div class="card grade-card">
    <div class="syl-head"><b>${esc(title)}</b><small>${g.gradedWeight?`${pctText(g.earned)} earned of ${pctText(g.gradedWeight)} graded · ${pctText(g.earned/g.gradedWeight*100)} average`:"No scores yet"}</small></div>
    <div class="grade-bar" title="Earned, lost and still to come">
      <span class="earned" style="width:${g.earned/scale*100}%"></span>
      <span class="lost" style="width:${(g.gradedWeight-g.earned)/scale*100}%"></span>
      <span class="left" style="width:${g.remaining/scale*100}%"></span>
    </div>
    <p class="grade-legend"><i class="earned"></i>Earned <i class="lost"></i>Lost <i class="left"></i>${pctText(g.remaining)} still to come</p>
    ${targetLineHTML(m,g)}
    ${Math.abs(g.total-100)>0.5?`<div class="grade-warn">Weights add up to ${pctText(g.total)}, not 100%. Check the outline or add the missing component in a new file.</div>`:""}
    <div class="grade-rows">${(m.assessments||[]).map((a,i)=>weightValue(a.weight)==null?"":`
      <button class="grade-row" data-grade="${esc(m.code)}|${i}">
        <span class="grade-title">${esc(a.title)}<small>${esc(weightLabel(a.weight))}${!a.date&&!a.week?" · ongoing":""}${a.group&&a.best?` · best ${a.best} of ${(m.assessments||[]).filter(x=>x.group===a.group).length} count`:""}</small></span>
        <span class="grade-score ${a.score==null?"empty":""}">${a.score==null?"Add score":`${esc(a.scoreText||pctText(a.score))}<small>+${pctText(weightValue(a.weight)*a.score/100)}</small>`}</span>
      </button>`).join("")}</div>
  </div>`;
}

/* ---------- What do I need? ---------- */
// The average you need on what's left to finish the module on a target
// percentage. NUS grades are moderated, so the % for each letter grade varies
// by module; the target is a percentage, not a letter.

const TARGETS=[50,60,70,75,80,85,90];

// {need, best}: average needed on the remaining components, and the highest
// final percentage still possible.
function targetNeed(g,target){
  const best=g.earned+g.remaining;
  return {need:g.remaining>0.01?(target-g.earned)/g.remaining*100:null,best};
}

function needText(g,target){
  const {need,best}=targetNeed(g,target);
  if(need==null) return g.earned>=target?`You finished above ${target}%.`:`You finished below ${target}%.`;
  if(need<=0) return `${target}% is already secured, whatever you score on the rest.`;
  if(need>100) return `${target}% is out of reach: the most you can finish with is ${pctText(best)}.`;
  return `You need <b>${pctText(need)}</b> on average across the remaining ${pctText(g.remaining)}.`;
}

// Components still to be graded, leaving out "best N" groups already settled.
function ungradedTitles(m){
  const list=m.assessments||[];
  const settled=a=>a.group&&a.best&&list.filter(x=>x.group===a.group&&x.score!=null).length>=a.best;
  return list.filter(a=>weightValue(a.weight)!=null&&a.score==null&&!settled(a)).map(a=>a.title);
}

function targetLineHTML(m,g){
  if(!g.comps.length||g.remaining<0.01) return "";
  const t=m.target;
  const left=ungradedTitles(m);
  return `<button class="target-line" data-target="${esc(m.code)}">
    ${icon("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",16)}
    <span>${t==null?`<b>What do I need?</b> Set a target to see the score you need on ${esc(left.slice(0,2).join(" and ")||"the rest")}${left.length>2?" and the rest":""}.`
      :`<b>Aiming for ${t}%</b> · ${needText(g,t)}`}</span>${icon("M9 18l6-6-6-6",16)}</button>`;
}

function openTargetSheet(code){
  const m=syllabusModule(code);
  if(!m) return;
  const g=gradeSummary(m);
  const left=ungradedTitles(m);
  const row=t=>{
    const {need}=targetNeed(g,t);
    const label=need==null?"–":need<=0?"Secured":need>100?"Out of reach":pctText(need);
    const cls=need==null?"":need<=0?"ok":need>100?"no":need>85?"hard":"";
    return `<button class="target-row ${m.target===t?"on":""}" data-pick="${t}"><span>${t}% overall</span><b class="${cls}">${label}</b></button>`;
  };
  openModal(`<p class="kicker">${esc(code)} · WHAT DO I NEED?</p><h2>Score needed on the rest</h2>
    <p class="subtle">So far you've earned ${pctText(g.earned)} of ${pctText(g.gradedWeight)} graded. Still to come: ${pctText(g.remaining)}${left.length?` (${esc(left.join(", "))})`:""}. The most you can finish with is ${pctText(g.earned+g.remaining)}.</p>
    <div class="target-table"><div class="target-head"><span>Final result</span><span>Average needed</span></div>${TARGETS.map(row).join("")}</div>
    <form class="form" id="targetForm">
      <label>Your target (%)<input class="input" name="target" type="number" min="1" max="100" step="0.5" inputmode="decimal" value="${m.target??""}" placeholder="e.g. 78"></label>
      <div id="targetHint" class="small-help">${m.target!=null?needText(g,m.target):"Tap a row or type a target."}</div>
      <button class="btn primary full">Save target</button>
      ${m.target!=null?`<button type="button" class="btn ghost full" id="clearTarget">Clear target</button>`:""}
    </form>
    <p class="small-help">NUS grades are moderated, so the percentage for each letter grade differs by module. Use past cut-offs your seniors share as a guide.</p>`);
  const form=$("#targetForm");
  const valid=v=>Number.isFinite(v)&&v>0&&v<=100;
  form.target.oninput=()=>{ const v=parseFloat(form.target.value); $("#targetHint").innerHTML=valid(v)?needText(g,v):"Enter a percentage from 1 to 100."; };
  $$("[data-pick]").forEach(b=>b.onclick=()=>{ form.target.value=b.dataset.pick; form.target.oninput(); $$("[data-pick]").forEach(x=>x.classList.toggle("on",x===b)); });
  form.onsubmit=e=>{
    e.preventDefault();
    const v=parseFloat(form.target.value);
    if(!valid(v)){ $("#targetHint").textContent="Enter a percentage from 1 to 100."; return; }
    m.target=v; closeModal(); save(); toast("Target saved");
  };
  $("#clearTarget")?.addEventListener("click",()=>{ delete m.target; closeModal(); save(); });
}

// "17/20", "85%" or "85" -> 85
function parseScore(text){
  const t=String(text||"").trim();
  const frac=t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if(frac&&+frac[2]>0) return Math.min(100,+frac[1]/+frac[2]*100);
  const n=parseFloat(t.replace("%",""));
  return Number.isFinite(n)&&n>=0&&n<=100?n:null;
}

function openScoreSheet(code,i){
  const m=syllabusModule(code), a=m?.assessments?.[i];
  if(!a) return;
  openModal(`<p class="kicker">${esc(code)} · ${esc(weightLabel(a.weight))} OF FINAL GRADE</p><h2>${esc(a.title)}</h2>
    <form class="form" id="scoreForm">
      <input class="input big" name="score" value="${esc(a.scoreText||"")}" placeholder="e.g. 17/20 or 85%" inputmode="decimal" autocomplete="off" autofocus>
      <div id="scoreHint" class="small-help">Enter marks as a fraction or a percentage.</div>
      <button class="btn primary full">Save score</button>
      ${a.score!=null?`<button type="button" class="btn ghost full" id="clearScore">Clear score</button>`:""}
    </form>`);
  const form=$("#scoreForm");
  form.score.oninput=()=>{
    const p=parseScore(form.score.value);
    $("#scoreHint").textContent=p==null?"Enter marks as a fraction or a percentage.":`${pctText(p)} → ${pctText(weightValue(a.weight)*p/100)} of your final grade`;
  };
  form.onsubmit=e=>{
    e.preventDefault();
    const p=parseScore(form.score.value);
    if(p==null){ $("#scoreHint").textContent="That doesn't look like a score. Try 17/20 or 85%."; return; }
    a.score=p; a.scoreText=form.score.value.trim();
    closeModal(); save(); toast("Score saved");
  };
  $("#clearScore")?.addEventListener("click",()=>{ delete a.score; delete a.scoreText; closeModal(); save(); });
}

// Score rows and the import / help / remove buttons inside a view.
function bindSyllabusActions(el){
  $$("[data-grade]",el).forEach(b=>b.onclick=()=>{ const [code,i]=b.dataset.grade.split("|"); openScoreSheet(code,+i); });
  $$("[data-target]",el).forEach(b=>b.onclick=()=>openTargetSheet(b.dataset.target));
  $$("[data-assess-toggle]",el).forEach(b=>b.onclick=e=>{ e.stopPropagation(); const [code,i]=b.dataset.assessToggle.split("|"); toggleAssessmentDone(code,+i); });
  $$("[data-assess-open]",el).forEach(b=>b.onclick=()=>{ const [code,i]=b.dataset.assessOpen.split("|"); openAssessmentSheet(code,+i); });
  $$("[data-syl=help]",el).forEach(b=>b.onclick=openSyllabusHelp);
  $$("[data-syl=import]",el).forEach(b=>b.onclick=openSyllabusImporter);
  $$("[data-syl=clear]",el).forEach(b=>b.onclick=async()=>{
    if(!await confirmSheet("Remove the syllabus? Your scores are removed too.",{confirm:"Remove"})) return;
    state.syllabus={modules:[]};
    save({immediate:true}); toast("Syllabus removed");
  });
}

// The first time assessments show as tasks, ones already past count as done.
window.addEventListener("nus-cloud-state-applied",()=>{
  if(!state.syllabus?.modules?.length||state.syllabus.assessTasksAt) return;
  markPastAssessmentsDone(state.syllabus.modules);
  state.syllabus.assessTasksAt=Date.now();
  save({immediate:true}).catch(err=>console.warn("Couldn't mark past assessments done",err));
});

// Earlier versions copied dated assessments into Tasks. Assessments are now
// their own thing, so remove those copies once the account's data has loaded.
window.addEventListener("nus-cloud-state-applied",()=>{
  if(!state.tasks.some(t=>t.source==="syllabus")) return;
  state.tasks=state.tasks.filter(t=>t.source!=="syllabus");
  save({immediate:true}).catch(err=>console.warn("Couldn't remove old assessment tasks",err));
});
