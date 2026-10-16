/* More tab: account, modules (NUSMods import), activities, reminders, settings. */

views.more=(()=>{
  let el=null;

  function row(go,iconPath,title,sub,extra=""){
    return `<button class="list-row tap" ${go}><span class="row-icon">${icon(iconPath,20)}</span><div><b>${title}</b>${sub?`<small>${sub}</small>`:""}</div>${extra||icon("M9 18l6-6-6-6",18)}</button>`;
  }

  function render(){
    const user=window.nusFirebase?.user;
    const name=user?.displayName||user?.email||"Signed in";
    const light=document.body.classList.contains("light");
    const notif=notificationStatus();
    el.innerHTML=`
      ${pageHeader("More")}
      <div class="card account-card">
        <div class="avatar">${esc((name||"?").trim().charAt(0).toUpperCase())}</div>
        <div><b>${esc(name)}</b><small>${esc(user?.email&&user.email!==name?user.email:"Synced across your devices")}</small></div>
      </div>

      <h4 class="group-title">Your semester</h4>
      <div class="card flush list">
        ${row(`data-go="more/modules"`,"M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z","Modules & timetable",`${state.modules.length} module${state.modules.length===1?"":"s"} · ${state.lessons.length} classes`)}
        ${row(`data-go="more/activities"`,"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h8M12 8v8","Activities",`${state.activities.length} saved`)}
      </div>

      <h4 class="group-title">Settings</h4>
      <div class="card flush list">
        ${row(`id="moreReminders"`,"M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0","Reminders",notif==="granted"?"On for this device":"Off · tap to turn on")}
        ${row(`id="moreTheme"`,light?"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z":"M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4","Dark mode","",`<span class="switch ${light?"":"on"}"></span>`)}
        ${canInstallApp()?row(`id="moreInstall"`,"M12 3v12M7 10l5 5 5-5M5 21h14","Install app","Add NUS Companion to your Home Screen"):""}
        ${row(`id="moreSync"`,"M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5","Sync now","Changes sync automatically")}
      </div>

      <button class="btn danger-soft full" id="signOut">Sign out</button>
      <p class="footnote">NUS Companion · AY${esc(state.semester.academicYear)} Sem ${esc(state.semester.semester)}<br>Independent project, not affiliated with NUS or NUSMods.</p>`;

    $("#moreReminders",el).onclick=openReminders;
    $("#moreTheme",el).onclick=()=>{ setTheme(document.body.classList.contains("light")?"dark":"light"); render(); };
    $("#moreInstall",el)?.addEventListener("click",setupInstall);
    $("#moreSync",el).onclick=async()=>{ try{ await syncNow(); }catch(err){ toast(readableFirebaseError(err)); } };
    $("#signOut",el).onclick=async()=>{ if(await confirmSheet("Sign out of NUS Companion?",{confirm:"Sign out"})) signOutUser(); };
  }

  return {title:"More", mount(c){ el=c; }, show(){ render(); }, refresh(){ render(); }};
})();

/* ---------- Activities ---------- */

views["more/activities"]=(()=>{
  let el=null;
  function render(){
    const weekly=state.activities.filter(a=>a.recurring).sort((a,b)=>DAYS.indexOf(a.day)-DAYS.indexOf(b.day)||String(a.startTime).localeCompare(b.startTime));
    const once=state.activities.filter(a=>!a.recurring).sort((a,b)=>String(a.date).localeCompare(b.date));
    const card=a=>`<button class="list-row tap" data-id="${esc(a.id)}">
      <span class="row-icon accent2">${icon("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",18)}</span>
      <div><b>${esc(a.name)}</b><small>${esc(a.recurring?a.day:fmtDate(a.date))} · ${inputTimeToLabel(a.startTime)}${a.venue?` · ${esc(a.venue)}`:""}${a.club?` · ${esc(a.club)}`:""}</small></div>${icon("M9 18l6-6-6-6",18)}</button>`;
    el.innerHTML=`
      ${pageHeader("Activities",{back:"more"})}
      ${weekly.length?`<h4 class="group-title">Every week</h4><div class="card flush list">${weekly.map(card).join("")}</div>`:""}
      ${once.length?`<h4 class="group-title">One-time</h4><div class="card flush list">${once.map(card).join("")}</div>`:""}
      ${!state.activities.length?`<div class="empty-state">${icon("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h8M12 8v8",40)}<h3>No activities yet</h3><p>Add CCA sessions and events so they show up in your schedule.</p></div>`:""}
      <button class="fab" id="addActivity" aria-label="Add activity">${icon("M12 5v14M5 12h14",26)}</button>`;
    $$("[data-id]",el).forEach(b=>b.onclick=()=>openActivitySheet(state.activities.find(a=>a.id===b.dataset.id)));
    $("#addActivity",el).onclick=()=>openActivityForm();
  }
  return {title:"Activities", mount(c){ el=c; }, show(){ render(); }, refresh(){ render(); }};
})();

/* ---------- Modules ---------- */

views["more/modules"]=(()=>{
  let el=null;

  function render(){
    el.innerHTML=`
      ${pageHeader("Modules",{back:"more",eyebrow:`AY${esc(state.semester.academicYear)} · Semester ${esc(state.semester.semester)}`})}
      <div class="import-actions">
        <button class="card import-card primary-card" id="importLink">${icon("M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",22)}<b>Paste NUSMods link</b><small>Import your whole timetable at once</small></button>
        <button class="card import-card" id="importSearch">${icon("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",22)}<b>Add a module</b><small>Search NUSMods and pick classes</small></button>
      </div>
      ${state.modules.length?`<div class="card flush list">${state.modules.map(m=>{
        const lessons=state.lessons.filter(l=>l.module===m.code);
        const types=[...new Set(lessons.map(l=>`${(l.lessonType||"Class").slice(0,3).toUpperCase()} ${l.classNo||""}`.trim()))];
        return `<button class="list-row tap" data-code="${esc(m.code)}"><span class="mod-badge">${esc(m.code.replace(/\d.*/,""))}</span>
          <div><b>${esc(m.code)}</b><small>${esc(m.name)}</small>${types.length?`<span class="tags">${types.map(t=>`<i>${esc(t)}</i>`).join("")}</span>`:`<small class="warn-text">No classes yet</small>`}</div>${icon("M9 18l6-6-6-6",18)}</button>`;
      }).join("")}</div>
      <button class="btn ghost danger-text full" id="removeAll">Remove all modules</button>`
      :`<div class="empty-state">${icon("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z",40)}<h3>No modules yet</h3><p>On NUSMods, tap <b>Share/Sync</b>, copy the link, then paste it here.</p></div>`}`;

    $("#importLink",el).onclick=openLinkImporter;
    $("#importSearch",el).onclick=openModuleSearch;
    $$("[data-code]",el).forEach(b=>b.onclick=()=>openModuleSheet(b.dataset.code));
    $("#removeAll",el)?.addEventListener("click",async()=>{
      if(!await confirmSheet("Remove all modules and classes? Tasks and activities are kept.",{confirm:"Remove all"})) return;
      state.modules=[]; state.lessons=[];
      save({immediate:true}); toast("All modules removed");
    });
  }

  /* ----- Module detail ----- */

  function openModuleSheet(code){
    const mod=state.modules.find(m=>m.code===code);
    if(!mod) return;
    const lessons=state.lessons.filter(l=>l.module===code).sort((a,b)=>DAYS.indexOf(a.day)-DAYS.indexOf(b.day)||timeToMinutes(a.startTime)-timeToMinutes(b.startTime));
    openModal(`<p class="kicker">MODULE</p><h2>${esc(mod.code)}</h2><p class="subtle">${esc(mod.name)}</p>
      <div class="list lesson-list">${lessons.length?lessons.map(l=>`
        <div class="list-row">
          <div><b>${esc(l.lessonType||"Class")} ${esc(l.classNo&&l.classNo!=="TBC"?l.classNo:"")}</b><small>${esc(l.day)} · ${inputTimeToLabel(l.startTime)} – ${inputTimeToLabel(l.endTime)} · ${esc(weeksLabel(l.weeks))}</small></div>
          ${venueLink(l.venue)}
        </div>`).join(""):`<div class="empty-inline">No classes yet.</div>`}</div>
      <div class="sheet-actions">
        <button class="btn primary" id="pickGroups">Change classes from NUSMods</button>
        <button class="btn secondary" id="editLessons">Edit timings manually</button>
        <button class="btn danger-soft" id="deleteModule">Remove ${esc(mod.code)}</button>
      </div>`);
    $("#pickGroups").onclick=()=>openGroupPicker(mod.code,{replace:true});
    $("#editLessons").onclick=()=>openLessonEditor(mod.code);
    $("#deleteModule").onclick=async()=>{
      if(!await confirmSheet(`Remove ${mod.code} and its classes?`,{confirm:"Remove"})) return;
      state.modules=state.modules.filter(m=>m.code!==code);
      state.lessons=state.lessons.filter(l=>l.module!==code);
      save({immediate:true}); toast(`${code} removed`);
    };
  }

  /* ----- NUSMods share link ----- */

  function parseShareLink(raw){
    let url;
    try{ url=new URL(String(raw||"").trim()); }catch{ throw new Error("That doesn't look like a link. Copy the full link from NUSMods."); }
    if(!/(^|\.)nusmods\.com$/i.test(url.hostname)) throw new Error("Please paste a timetable link from nusmods.com.");
    const parts=[];
    for(const [code,value] of url.searchParams.entries()){
      if(["hidden","ta"].includes(code.toLowerCase())) continue;
      const lessons=String(value||"").split(",").map(tok=>{
        const i=tok.indexOf(":");
        return i>0?{raw:tok,type:tok.slice(0,i).trim().toUpperCase(),classNo:tok.slice(i+1).trim()}:null;
      }).filter(Boolean);
      parts.push({code:code.trim().toUpperCase(),lessons});
    }
    if(!parts.length) throw new Error("No modules were found in that link.");
    return parts;
  }

  function typeMatches(abbr,lessonType){
    const t=String(lessonType||"").toUpperCase().replace(/[^A-Z]/g,"");
    const aliases={LEC:["LECTURE"],TUT:["TUTORIAL"],REC:["RECITATION"],LAB:["LABORATORY"],SEC:["SECTIONAL"],SEM:["SEMINAR"],DLEC:["DESIGNLECTURE"],PLEC:["PACKAGEDLECTURE"],PTUT:["PACKAGEDTUTORIAL"],WS:["WORKSHOP"]};
    return (aliases[abbr]||[]).some(x=>t.startsWith(x)) || t.startsWith(abbr);
  }

  function openLinkImporter(){
    openModal(`<h2>Import from NUSMods</h2>
      <ol class="steps"><li>Open <b>nusmods.com</b> → Timetable</li><li>Tap <b>Share/Sync</b> and copy the link</li><li>Paste it below</li></ol>
      <textarea class="input" id="shareLink" rows="3" placeholder="https://nusmods.com/timetable/sem-1/share?…"></textarea>
      <div id="linkError"></div>
      <button class="btn primary full" id="doImport">Import timetable</button>
      <p class="small-help">Modules in the link replace the same modules here. Other modules, tasks and activities are kept.</p>`);
    navigator.clipboard?.readText?.().then(t=>{ if(/nusmods\.com/.test(t)&&!$("#shareLink").value) $("#shareLink").value=t; }).catch(()=>{});
    $("#doImport").onclick=async()=>{
      let parts;
      try{ parts=parseShareLink($("#shareLink").value); }
      catch(e){ $("#linkError").innerHTML=`<div class="error-box">${esc(e.message)}</div>`; return; }
      await importShare(parts);
    };
  }

  async function importShare(parts){
    const results=[], problems=[];
    openModal(`<h2>Importing…</h2><div class="progress-box"><span class="spinner"></span><p id="importProgress">Starting</p></div>`);
    for(const [i,item] of parts.entries()){
      const p=$("#importProgress"); if(p) p.textContent=`${item.code} (${i+1} of ${parts.length})`;
      try{
        const data=normaliseLessonData(await fetchNUSModsModule(item.code),item.code);
        const chosen=[];
        for(const w of item.lessons){
          const m=data.timetable.filter(l=>typeMatches(w.type,l.lessonType)&&String(l.classNo).toUpperCase()===w.classNo.toUpperCase());
          if(m.length) chosen.push(...m); else problems.push(`${item.code} ${w.raw} wasn't found`);
        }
        results.push({code:item.code,name:data.title,lessons:chosen});
      }catch(e){ problems.push(`${item.code}: ${e.message}`); }
    }
    if(!results.length){
      openModal(`<h2>Import failed</h2><div class="error-box">${problems.map(esc).join("<br>")||"Nothing could be imported."}</div>`);
      return;
    }
    const codes=new Set(results.map(r=>r.code));
    state.modules=state.modules.filter(m=>!codes.has(m.code));
    state.lessons=state.lessons.filter(l=>!codes.has(l.module));
    let n=Date.now();
    for(const r of results){
      state.modules.push({code:r.code,name:r.name});
      r.lessons.forEach(l=>state.lessons.push({...l,module:r.code,id:`${r.code}-${n++}`}));
    }
    save({immediate:true});
    const count=results.reduce((s,r)=>s+r.lessons.length,0);
    openModal(`<div class="success-hero">${icon("M20 6 9 17l-5-5",36)}</div><h2>Timetable imported</h2>
      <p class="subtle">${results.length} module${results.length===1?"":"s"} · ${count} classes</p>
      ${problems.length?`<div class="error-box"><b>Some classes couldn't be matched:</b><br>${problems.map(esc).join("<br>")}</div>`:""}
      <button class="btn primary full" data-go="schedule">See my schedule</button>`);
  }

  /* ----- Search NUSMods ----- */

  async function openModuleSearch(){
    openModal(`<h2>Add a module</h2>
      <input class="input" id="modSearch" placeholder="Search code or title, e.g. CS2030" autocomplete="off" autocapitalize="characters">
      <div class="list" id="modResults"><div class="empty-inline"><span class="spinner sm"></span>Loading NUSMods…</div></div>
      <button class="btn ghost full" id="manualModule">Add one that's not on NUSMods</button>`);
    $("#manualModule").onclick=openManualModule;
    let list;
    try{ list=await fetchNUSModsList(); }
    catch(e){ $("#modResults").innerHTML=`<div class="error-box">${esc(e.message)}</div>`; return; }
    const input=$("#modSearch");
    const draw=()=>{
      const q=input.value.trim().toLowerCase();
      const rows=q?list.filter(m=>`${m.moduleCode} ${m.title}`.toLowerCase().includes(q)).sort((a,b)=>(b.moduleCode.toLowerCase().startsWith(q))-(a.moduleCode.toLowerCase().startsWith(q))).slice(0,30):[];
      $("#modResults").innerHTML=rows.length?rows.map(m=>`<button class="list-row tap" data-code="${esc(m.moduleCode)}"><div><b>${esc(m.moduleCode)}</b><small>${esc(m.title)}</small></div>${state.modules.some(x=>x.code===m.moduleCode)?`<span class="pill">Added</span>`:icon("M12 5v14M5 12h14",18)}</button>`).join("")
        :`<div class="empty-inline">${q?"No matching modules.":"Start typing to search."}</div>`;
      $$("[data-code]",$("#modResults")).forEach(b=>b.onclick=()=>openGroupPicker(b.dataset.code,{replace:true}));
    };
    input.addEventListener("input",draw);
    draw();
    input.focus();
  }

  function openManualModule(){
    openModal(`<h2>Add module manually</h2>
      <form class="form" id="manualForm">
        <input class="input" name="code" placeholder="Module code" required autocapitalize="characters">
        <input class="input" name="name" placeholder="Module name" required>
        <button class="btn primary full">Add module</button>
      </form>`);
    $("#manualForm").onsubmit=e=>{
      e.preventDefault();
      const f=new FormData(e.target), code=String(f.get("code")).trim().toUpperCase();
      if(state.modules.some(m=>m.code===code)){ toast("Already added"); return; }
      state.modules.push({code,name:String(f.get("name")).trim()});
      save(); openLessonEditor(code);
    };
  }

  // Choose lesson groups for a module. One choice per lesson type is the
  // common case, so picking a group replaces any other group of that type.
  async function openGroupPicker(code,{replace=false}={}){
    openModal(`<h2>${esc(code)}</h2><div class="progress-box"><span class="spinner"></span><p>Loading classes…</p></div>`);
    let data;
    try{ data=normaliseLessonData(await fetchNUSModsModule(code),code); }
    catch(e){ openModal(`<h2>${esc(code)}</h2><div class="error-box">${esc(e.message)}</div>`); return; }
    const typeOrder=t=>{ const i=["Lecture","Tutorial","Recitation","Laboratory"].findIndex(x=>t.startsWith(x)); return i<0?9:i; };
    const groups=lessonGroups(data).sort(([a],[b])=>{
      const [ta,na]=a.split("::"), [tb,nb]=b.split("::");
      return typeOrder(ta)-typeOrder(tb) || ta.localeCompare(tb) || na.localeCompare(nb,undefined,{numeric:true});
    });
    if(!groups.length){
      openModal(`<h2>${esc(code)}</h2><p class="subtle">${esc(data.title)}</p><div class="error-box">NUSMods has no Semester ${esc(SEMESTER)} classes for this module.</div>
        <button class="btn secondary full" id="addAnyway">Add without classes</button>`);
      $("#addAnyway").onclick=()=>{
        if(!state.modules.some(m=>m.code===code)) state.modules.push({code,name:data.title});
        closeModal(); save();
      };
      return;
    }
    const current=new Set(state.lessons.filter(l=>l.module===code).map(lessonKey));
    const byType=new Map();
    for(const [key,ls] of groups){ const t=key.split("::")[0]; if(!byType.has(t)) byType.set(t,[]); byType.get(t).push([key,ls]); }
    const picked=new Set(current);
    // Pre-select the only option when a type has a single group (usually lectures).
    for(const [,gs] of byType) if(gs.length===1) picked.add(gs[0][0]);

    openModal(`<h2>${esc(code)}</h2><p class="subtle">${esc(data.title)}</p>
      ${[...byType].map(([type,gs])=>`
        <h4 class="sub-head">${esc(type)}<small>${gs.length} option${gs.length===1?"":"s"}</small></h4>
        <div class="group-options">${gs.map(([key,ls])=>`
          <button class="group-opt ${picked.has(key)?"on":""}" data-key="${esc(key)}" data-type="${esc(type)}">
            <b>${esc(key.split("::")[1])}</b>
            ${ls.map(l=>`<small>${esc(l.day.slice(0,3))} ${inputTimeToLabel(l.startTime)}–${inputTimeToLabel(l.endTime)}${l.venue?` · ${esc(l.venue)}`:""}</small>`).join("")}
          </button>`).join("")}</div>`).join("")}
      <button class="btn primary full sticky-bottom" id="saveGroups">Save ${esc(code)}</button>`,{wide:true});

    $$(".group-opt").forEach(b=>b.onclick=()=>{
      const was=picked.has(b.dataset.key);
      $$(`.group-opt[data-type="${CSS.escape(b.dataset.type)}"]`).forEach(o=>{ picked.delete(o.dataset.key); o.classList.remove("on"); });
      if(!was){ picked.add(b.dataset.key); b.classList.add("on"); }
    });
    $("#saveGroups").onclick=()=>{
      const chosen=data.timetable.filter(l=>picked.has(lessonKey(l)));
      state.modules=state.modules.filter(m=>m.code!==code);
      state.modules.push({code,name:data.title});
      if(replace) state.lessons=state.lessons.filter(l=>l.module!==code);
      let n=Date.now();
      chosen.forEach(l=>state.lessons.push({...l,module:code,id:`${code}-${n++}`}));
      closeModal(); save({immediate:true}); toast(`${code} saved`);
    };
  }

  /* ----- Manual lesson editor ----- */

  // Which teaching weeks a class runs: every week, odd, even or picked weeks.
  // Saved as the lesson's `weeks` list (missing = every week), as NUSMods does.
  const ODD=TEACHING_WEEKS.filter(w=>w%2), EVEN=TEACHING_WEEKS.filter(w=>w%2===0);

  function weeksMode(weeks){
    if(weeks && !Array.isArray(weeks)) return "dates";
    const label=weeksLabel(weeks);
    return {"Every week":"every","Odd weeks":"odd","Even weeks":"even"}[label]||"custom";
  }

  function weeksPickerHTML(weeks){
    const mode=weeksMode(weeks);
    if(mode==="dates") return `<div class="weeks-picker" data-mode="dates"><small class="subtle">${esc(weeksLabel(weeks))} (from NUSMods)</small></div>`;
    const on=new Set(Array.isArray(weeks)&&weeks.length?weeks:TEACHING_WEEKS);
    return `<div class="weeks-picker" data-mode="${mode}">
      <div class="seg-mini">${[["every","Weekly"],["odd","Odd"],["even","Even"],["custom","Custom"]].map(([k,l])=>`<button type="button" class="${mode===k?"on":""}" data-wmode="${k}">${l}</button>`).join("")}</div>
      <div class="week-chips" ${mode==="custom"?"":"hidden"}>${TEACHING_WEEKS.map(w=>`<button type="button" class="${on.has(w)?"on":""}" data-week="${w}">${w}</button>`).join("")}</div>
    </div>`;
  }

  function wireWeeksPicker(box){
    if(!box || box.dataset.mode==="dates") return;
    $$("[data-wmode]",box).forEach(b=>b.onclick=()=>{
      box.dataset.mode=b.dataset.wmode;
      $$("[data-wmode]",box).forEach(o=>o.classList.toggle("on",o===b));
      const chips=$(".week-chips",box);
      chips.hidden=b.dataset.wmode!=="custom";
      const preset={every:TEACHING_WEEKS,odd:ODD,even:EVEN}[b.dataset.wmode];
      if(preset) $$("[data-week]",chips).forEach(c=>c.classList.toggle("on",preset.includes(+c.dataset.week)));
    });
    $$("[data-week]",box).forEach(c=>c.onclick=()=>c.classList.toggle("on"));
  }

  // undefined = every week, null = leave as is, else the list of weeks.
  function readWeeksPicker(box){
    if(!box || box.dataset.mode==="dates") return null;
    const mode=box.dataset.mode;
    if(mode==="every") return undefined;
    if(mode==="odd") return ODD;
    if(mode==="even") return EVEN;
    const picked=$$("[data-week].on",box).map(c=>+c.dataset.week);
    return picked.length===TEACHING_WEEKS.length||!picked.length ? undefined : picked;
  }

  function openLessonEditor(code){
    const mod=state.modules.find(m=>m.code===code);
    const draft=state.lessons.filter(l=>l.module===code).map(l=>({...l}));
    const pickers=[];
    const types=["Lecture","Tutorial","Recitation","Laboratory","Sectional Teaching","Seminar-Style Module Class","Workshop","Class"];

    const draw=()=>{
      pickers.length=0;
      $("#lessonRows").innerHTML=draft.map((l,i)=>`
        <div class="lesson-edit" data-i="${i}">
          <div class="two">
            <select class="input" data-f="lessonType">${[...new Set([l.lessonType||"Class",...types])].map(t=>`<option ${t===(l.lessonType||"Class")?"selected":""}>${esc(t)}</option>`).join("")}</select>
            <input class="input" data-f="classNo" value="${esc(l.classNo||"")}" placeholder="Group">
          </div>
          <div class="three">
            <select class="input" data-f="day">${DAYS.map(d=>`<option ${l.day===d?"selected":""}>${d}</option>`).join("")}</select>
            <input class="input" type="time" data-f="startTime" value="${esc(minutesToInput(timeToMinutes(l.startTime)))}">
            <input class="input" type="time" data-f="endTime" value="${esc(minutesToInput(timeToMinutes(l.endTime)))}">
          </div>
          <div class="venue-slot"></div>
          ${weeksPickerHTML(l.weeks)}
          <button type="button" class="link danger-text" data-remove="${i}">Remove</button>
        </div>`).join("")||`<div class="empty-inline">No classes. Add one below.</div>`;
      $$(".lesson-edit").forEach((row,i)=>pickers[i]=venuePicker($(".venue-slot",row),{value:draft[i].venue||"",lat:draft[i].venueLat,lng:draft[i].venueLng,placeholder:"Venue"}));
      $$("[data-remove]").forEach(b=>b.onclick=()=>{ collect(); draft.splice(+b.dataset.remove,1); draw(); });
      $$(".lesson-edit").forEach(row=>wireWeeksPicker($(".weeks-picker",row)));
    };
    const collect=()=>{
      $$(".lesson-edit").forEach((row,i)=>{
        $$("[data-f]",row).forEach(f=>draft[i][f.dataset.f]=f.value);
        Object.assign(draft[i],pickers[i].get());
        const weeks=readWeeksPicker($(".weeks-picker",row));
        if(weeks===undefined) delete draft[i].weeks; else if(weeks) draft[i].weeks=weeks;
      });
    };

    openModal(`<h2>${esc(code)} classes</h2>
      <form class="form" id="lessonForm">
        <input class="input" name="name" value="${esc(mod?.name||"")}" placeholder="Module name">
        <div id="lessonRows"></div>
        <button type="button" class="btn ghost full" id="addLesson">+ Add a class</button>
        <button class="btn primary full">Save</button>
      </form>`,{wide:true});
    draw();
    $("#addLesson").onclick=()=>{ collect(); draft.push({id:`${code}-${Date.now()}`,module:code,lessonType:"Tutorial",classNo:"",day:"Monday",startTime:"10:00",endTime:"11:00",venue:""}); draw(); };
    $("#lessonForm").onsubmit=e=>{
      e.preventDefault();
      collect();
      if(mod) mod.name=String(new FormData(e.target).get("name")||mod.name).trim();
      state.lessons=[...state.lessons.filter(l=>l.module!==code),...draft.filter(l=>l.day&&l.startTime&&l.endTime)];
      closeModal(); save(); toast(`${code} updated`);
    };
  }

  return {
    title:"Modules",
    mount(c){ el=c; },
    show(params){ render(); if(params.module) setTimeout(()=>openModuleSheet(params.module),50); },
    refresh(){ render(); }
  };
})();
