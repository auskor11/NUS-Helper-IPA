/* Schedule tab: Day agenda (default), Week grid and Month overview.
 * Tapping anything opens its details in a sheet; tapping a venue opens it
 * on the Map tab.
 */

/* ---------- Detail sheets ---------- */

function openLessonSheet(lesson){
  const mod=state.modules.find(m=>m.code===lesson.module);
  openModal(`<p class="kicker">${esc(lesson.lessonType||"Class")}${lesson.classNo&&lesson.classNo!=="TBC"?` · Group ${esc(lesson.classNo)}`:""}</p>
    <h2>${esc(lesson.module)}</h2>
    <p class="subtle">${esc(mod?.name||"")}</p>
    <div class="detail-list">
      <div>${icon("M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",18)}<span>Every ${esc(lesson.day)}</span></div>
      <div>${icon("M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",18)}<span>${inputTimeToLabel(lesson.startTime)} – ${inputTimeToLabel(lesson.endTime)}</span></div>
    </div>
    <div class="sheet-actions">
      ${lesson.venue?`<button class="btn primary" data-go="map" data-params='${esc(JSON.stringify({venue:lesson.venue}))}'>Show ${esc(lesson.venue)} on map</button>`:""}
      <button class="btn secondary" data-go="more/modules" data-params='${esc(JSON.stringify({module:lesson.module}))}'>Edit ${esc(lesson.module)}</button>
    </div>`);
}

function openActivitySheet(a){
  openModal(`<p class="kicker">${esc(a.club||"Activity")}</p>
    <h2>${esc(a.name)}</h2>
    <div class="detail-list">
      <div>${icon("M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",18)}<span>${a.recurring?`Every ${esc(a.day)}`:esc(fmtDate(a.date))}</span></div>
      <div>${icon("M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",18)}<span>${inputTimeToLabel(a.startTime)} – ${inputTimeToLabel(a.endTime)}</span></div>
      ${a.module?`<div>${icon("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z",18)}<span>${esc(a.module)}</span></div>`:""}
    </div>
    <div class="sheet-actions">
      ${a.venue?`<button class="btn primary" data-go="map" data-params='${esc(JSON.stringify({venue:a.venue}))}'>Show ${esc(a.venue)} on map</button>`:""}
      <button class="btn secondary" id="editActivity">Edit</button>
    </div>`);
  $("#editActivity").onclick=()=>openActivityForm(a);
}

function openActivityForm(existing=null,{date=""}={}){
  const a=existing||{recurring:!date,day:date?dayName(new Date(`${date}T12:00`)):"Monday",date,startTime:"19:00",endTime:"21:00"};
  const opts=state.modules.map(m=>`<option value="${esc(m.code)}" ${a.module===m.code?"selected":""}>${esc(m.code)}</option>`).join("");
  openModal(`<h2>${existing?"Edit activity":"New activity"}</h2>
    <form class="form" id="activityForm">
      <input class="input big" name="name" value="${esc(a.name||"")}" placeholder="Activity, e.g. Basketball training" required>
      <input class="input" name="club" value="${esc(a.club||"")}" placeholder="Club or organisation (optional)">
      <div class="segmented small" id="repeatSeg">
        <button type="button" data-rec="true" class="${a.recurring?"on":""}">Every week</button>
        <button type="button" data-rec="false" class="${a.recurring?"":"on"}">One time</button>
      </div>
      <label class="rec-weekly">Day<select class="input" name="day">${DAYS.map(d=>`<option ${a.day===d?"selected":""}>${d}</option>`).join("")}</select></label>
      <label class="rec-once">Date<input class="input" type="date" name="date" value="${esc(a.date||isoDate(new Date()))}"></label>
      <div class="two">
        <label>Starts<input class="input" type="time" name="startTime" value="${esc(a.startTime||"")}" required></label>
        <label>Ends<input class="input" type="time" name="endTime" value="${esc(a.endTime||"")}" required></label>
      </div>
      <label>Location<div id="activityVenue"></div></label>
      ${opts?`<label><span>Related module <span class="optional">optional</span></span><select class="input" name="module"><option value="">None</option>${opts}</select></label>`:""}
      <button class="btn primary full">${existing?"Save":"Add activity"}</button>
      ${existing?`<button type="button" class="btn danger-soft full" id="deleteActivity">Delete activity</button>`:""}
    </form>`);

  const form=$("#activityForm");
  let recurring=a.recurring!==false;
  const syncRepeat=()=>{
    $$("#repeatSeg button").forEach(b=>b.classList.toggle("on",(b.dataset.rec==="true")===recurring));
    $(".rec-weekly",form).hidden=!recurring;
    $(".rec-once",form).hidden=recurring;
  };
  $$("#repeatSeg button").forEach(b=>b.onclick=()=>{ recurring=b.dataset.rec==="true"; syncRepeat(); });
  syncRepeat();
  const picker=venuePicker($("#activityVenue"),{value:a.venue||"",lat:a.venueLat,lng:a.venueLng,source:a.venueSource});

  form.onsubmit=e=>{
    e.preventDefault();
    const f=new FormData(form);
    const v=picker.get();
    const data={
      name:String(f.get("name")).trim(), club:String(f.get("club")||"").trim(), module:String(f.get("module")||""),
      recurring, day:recurring?String(f.get("day")):"", date:recurring?"":String(f.get("date")||""),
      startTime:String(f.get("startTime")), endTime:String(f.get("endTime")),
      ...v
    };
    if(existing) Object.assign(existing,data);
    else state.activities.push({id:uid(),...data});
    closeModal(); save(); toast(existing?"Activity updated":"Activity added");
  };
  $("#deleteActivity")?.addEventListener("click",async()=>{
    if(!await confirmSheet(`Delete “${existing.name}”?`)) return;
    state.activities=state.activities.filter(x=>x.id!==existing.id);
    save({immediate:true}); toast("Activity deleted");
  });
}

function openAddChooser(date=""){
  openModal(`<h2>Add to ${date?esc(relativeDay(new Date(`${date}T12:00`))):"schedule"}</h2>
    <div class="choice-list">
      <button class="choice" id="chooseTask">${icon("M9 11l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z")}<span><b>Task or deadline</b><small>Assignments, readings, submissions</small></span></button>
      <button class="choice" id="chooseActivity">${icon("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v8M8 12h8")}<span><b>Activity</b><small>CCA sessions, events, meetings</small></span></button>
      <button class="choice" data-go="more/modules">${icon("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z")}<span><b>Classes</b><small>Import your NUSMods timetable</small></span></button>
    </div>`);
  $("#chooseTask").onclick=()=>openTaskForm(null,{date});
  $("#chooseActivity").onclick=()=>openActivityForm(null,{date});
}

function openScheduleItem(kind,id){
  if(kind==="lesson"){ const l=state.lessons.find(x=>x.id===id); if(l) openLessonSheet(l); }
  if(kind==="activity"){ const a=state.activities.find(x=>x.id===id); if(a) openActivitySheet(a); }
  if(kind==="task"){ const t=state.tasks.find(x=>x.id===id); if(t) openTaskForm(t); }
}

/* ---------- View ---------- */

views.schedule=(()=>{
  let el=null;
  let mode=localStorage.getItem("nus_schedule_mode")||"day";
  let selected=new Date(); selected.setHours(12,0,0,0);
  let monthCursor=new Date(selected.getFullYear(),selected.getMonth(),1);
  const HOUR_START=8, HOUR_END=22, ROW=56;

  function setMode(m){ mode=m; localStorage.setItem("nus_schedule_mode",m); render(); }

  function dayStrip(){
    const start=startOfWeek(selected);
    const today=new Date();
    return `<div class="week-strip">
      <button class="icon-btn sm" id="prevWeek" aria-label="Previous week">${icon("M15 18l-6-6 6-6",18)}</button>
      ${Array.from({length:7},(_,i)=>{
        const d=addDays(start,i);
        const has=itemsOnDate(d).length;
        return `<button class="day-pill ${sameDay(d,selected)?"on":""} ${sameDay(d,today)?"today":""}" data-date="${isoDate(d)}">
          <span>${d.toLocaleDateString("en-SG",{weekday:"narrow"})}</span><b>${d.getDate()}</b><i class="${has?"has":""}"></i>
        </button>`;
      }).join("")}
      <button class="icon-btn sm" id="nextWeek" aria-label="Next week">${icon("M9 18l6-6-6-6",18)}</button>
    </div>`;
  }

  function dayView(){
    const items=itemsOnDate(selected);
    const now=new Date(), nowMin=now.getHours()*60+now.getMinutes(), isToday=sameDay(selected,now);
    return `${dayStrip()}
      <h3 class="day-title">${esc(relativeDay(selected))}<span>${selected.toLocaleDateString("en-SG",{day:"numeric",month:"long"})}</span></h3>
      ${items.length?`<div class="card flush timeline">${items.map(x=>{
        const past=isToday && (x.kind==="task"?x.done:x.end<=nowMin);
        const live=isToday && x.kind!=="task" && x.start<=nowMin && x.end>nowMin;
        return `<button class="tl-row kind-${x.kind} ${past?"past":""} ${live?"live":""}" data-open="${x.kind}" data-id="${esc(x.id)}">
          <div class="tl-time">${minutesLabel(x.start)}${x.kind!=="task"?`<small>${minutesLabel(x.end)}</small>`:""}</div>
          <div class="tl-bar"></div>
          <div class="tl-main"><b>${x.kind==="task"&&x.done?"✓ ":""}${esc(x.title)}</b><small>${esc(x.kind==="lesson"?`${x.subtitle} · ${moduleName(x.title)}`:x.subtitle)}</small>
            ${x.venue?`<span class="tl-venue">${icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",12)}${esc(x.venue)}</span>`:""}</div>
          ${live?`<span class="pill live">Now</span>`:""}
        </button>`;
      }).join("")}</div>`
      :`<div class="empty-state">${icon("M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",40)}<h3>Free day</h3><p>Nothing scheduled ${sameDay(selected,now)?"today":"on this day"}.</p></div>`}`;
  }

  function weekView(){
    const start=startOfWeek(selected), days=Array.from({length:7},(_,i)=>addDays(start,i));
    const now=new Date(), nowMin=now.getHours()*60+now.getMinutes();
    const hours=HOUR_END-HOUR_START;
    return `<div class="toolbar">
        <button class="icon-btn sm" id="prevWeek">${icon("M15 18l-6-6 6-6",18)}</button>
        <b>${days[0].toLocaleDateString("en-SG",{day:"numeric",month:"short"})} – ${days[6].toLocaleDateString("en-SG",{day:"numeric",month:"short"})}</b>
        <button class="icon-btn sm" id="nextWeek">${icon("M9 18l6-6-6-6",18)}</button>
      </div>
      <div class="card flush week-wrap"><div class="week" style="--row:${ROW}px;--hours:${hours}">
        <div class="week-corner"></div>
        ${days.map(d=>`<button class="week-head ${sameDay(d,now)?"today":""}" data-date="${isoDate(d)}"><span>${d.toLocaleDateString("en-SG",{weekday:"short"})}</span><b>${d.getDate()}</b></button>`).join("")}
        <div class="week-axis">${Array.from({length:hours},(_,i)=>`<div>${(HOUR_START+i)%12||12}${HOUR_START+i<12?"a":"p"}</div>`).join("")}</div>
        ${days.map((d,i)=>`<div class="week-col" style="grid-column:${i+2}">
          ${itemsOnDate(d).map(x=>{
            const s=Math.max(HOUR_START*60,x.start), e=Math.min(HOUR_END*60,x.kind==="task"?x.start+30:x.end);
            if(e<=s) return "";
            return `<button class="week-ev kind-${x.kind}" style="top:${(s-HOUR_START*60)/60*ROW}px;height:${Math.max(24,(e-s)/60*ROW-2)}px" data-open="${x.kind}" data-id="${esc(x.id)}"><b>${esc(x.title)}</b><small>${esc(x.venue||x.subtitle||"")}</small></button>`;
          }).join("")}
          ${sameDay(d,now)&&nowMin>=HOUR_START*60&&nowMin<=HOUR_END*60?`<div class="now-line" style="top:${(nowMin-HOUR_START*60)/60*ROW}px"></div>`:""}
        </div>`).join("")}
      </div></div>`;
  }

  function monthView(){
    const y=monthCursor.getFullYear(), m=monthCursor.getMonth();
    const start=startOfWeek(new Date(y,m,1));
    const now=new Date();
    const cells=Array.from({length:42},(_,i)=>addDays(start,i));
    return `<div class="toolbar">
        <button class="icon-btn sm" id="prevMonth">${icon("M15 18l-6-6 6-6",18)}</button>
        <b>${monthCursor.toLocaleDateString("en-SG",{month:"long",year:"numeric"})}</b>
        <button class="icon-btn sm" id="nextMonth">${icon("M9 18l6-6-6-6",18)}</button>
      </div>
      <div class="card month">
        ${["M","T","W","T","F","S","S"].map(d=>`<div class="month-dow">${d}</div>`).join("")}
        ${cells.map(d=>{
          const tasks=state.tasks.filter(t=>t.dueDate===isoDate(d)&&!t.done).length;
          const acts=state.activities.filter(a=>activityOccursOnDate(a,d)).length;
          const lessons=state.lessons.some(l=>l.day===dayName(d));
          return `<button class="month-cell ${d.getMonth()===m?"":"out"} ${sameDay(d,now)?"today":""}" data-date="${isoDate(d)}">
            <b>${d.getDate()}</b>
            <span class="dots">${lessons?`<i class="d-lesson"></i>`:""}${acts?`<i class="d-activity"></i>`:""}${tasks?`<i class="d-task"></i>`:""}</span>
          </button>`;
        }).join("")}
      </div>
      <div class="legend"><span><i class="d-lesson"></i>Classes</span><span><i class="d-activity"></i>Activities</span><span><i class="d-task"></i>Deadlines</span></div>`;
  }

  function render(){
    el.innerHTML=`
      ${pageHeader("Schedule",{
        eyebrow:`AY${esc(state.semester.academicYear)} · Sem ${esc(state.semester.semester)}`,
        actions:sameDay(selected,new Date())&&mode!=="month"?"":`<button class="btn ghost sm" id="goToday">Today</button>`
      })}
      <div class="segmented">
        ${[["day","Day"],["week","Week"],["month","Month"]].map(([k,l])=>`<button class="${mode===k?"on":""}" data-mode="${k}">${l}</button>`).join("")}
      </div>
      ${mode==="day"?dayView():mode==="week"?weekView():monthView()}
      <button class="fab" id="addSchedule" aria-label="Add">${icon("M12 5v14M5 12h14",26)}</button>`;

    $$("[data-mode]",el).forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
    $("#goToday",el)?.addEventListener("click",()=>{ selected=new Date(); selected.setHours(12,0,0,0); monthCursor=new Date(selected.getFullYear(),selected.getMonth(),1); render(); });
    $("#prevWeek",el)?.addEventListener("click",()=>{ selected=addDays(selected,-7); render(); });
    $("#nextWeek",el)?.addEventListener("click",()=>{ selected=addDays(selected,7); render(); });
    $("#prevMonth",el)?.addEventListener("click",()=>{ monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()-1,1); render(); });
    $("#nextMonth",el)?.addEventListener("click",()=>{ monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()+1,1); render(); });
    $$("[data-date]",el).forEach(b=>b.onclick=()=>{
      selected=new Date(`${b.dataset.date}T12:00:00`);
      if(mode!=="day") setMode("day"); else render();
    });
    $$("[data-open]",el).forEach(b=>b.onclick=()=>openScheduleItem(b.dataset.open,b.dataset.id));
    $("#addSchedule",el).onclick=()=>openAddChooser(isoDate(selected));

    // Start the week grid scrolled to the current time.
    const wrap=$(".week-wrap",el);
    if(wrap){
      const h=Math.max(0,new Date().getHours()-HOUR_START-1);
      wrap.scrollTop=h*ROW;
    }
  }

  return {
    title:"Schedule",
    mount(c){ el=c; },
    show(params){
      if(params.date){ selected=new Date(`${params.date}T12:00:00`); mode="day"; }
      render();
    },
    refresh(){ render(); }
  };
})();
