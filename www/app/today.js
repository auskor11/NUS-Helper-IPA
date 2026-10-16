/* Today tab: what's next, today's plan, nearby shuttles and tasks due soon. */

views.today=(()=>{
  let el=null, shuttleTimer=null, clockTimer=null, shuttleStop=null;

  function greeting(){
    const h=new Date().getHours();
    const part=h<5?"Good night":h<12?"Good morning":h<18?"Good afternoon":"Good evening";
    const name=(window.nusFirebase?.user?.displayName||"").split(" ")[0];
    return name?`${part}, ${esc(name)}`:part;
  }

  function nextCard(){
    const n=nextEvent();
    if(!n){
      return `<div class="card hero empty-hero">
        <p class="kicker">UP NEXT</p>
        <h2>No classes yet</h2>
        <p class="subtle">Import your timetable to see your next class here.</p>
        <button class="btn primary" data-go="more/modules">Import timetable</button>
      </div>`;
    }
    const now=new Date();
    const live=n.startAt<=now && n.endAt>now;
    const mins=Math.round((n.startAt-now)/60000);
    const when=live?`Now · ends ${minutesLabel(n.end)}`:
      sameDay(n.date,now)?`In ${durationLabel(mins)} · ${minutesLabel(n.start)}`:
      `${relativeDay(n.date)} · ${minutesLabel(n.start)}`;
    return `<div class="card hero ${n.kind==="activity"?"hero-activity":""}">
      <div class="hero-top"><p class="kicker">${live?"HAPPENING NOW":"UP NEXT"}</p><span class="pill ${live?"live":""}">${esc(when)}</span></div>
      <h2>${esc(n.title)}</h2>
      <p class="hero-sub">${esc(n.kind==="lesson"?`${moduleName(n.title)} · ${n.subtitle}`:n.subtitle)}</p>
      <div class="hero-meta">
        <span>${icon("M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",15)} ${minutesLabel(n.start)} – ${minutesLabel(n.end)}</span>
        ${venueLink(n.venue,"venue-chip on-hero")}
      </div>
    </div>`;
  }

  function agendaRow(x,now){
    const nowMin=now.getHours()*60+now.getMinutes();
    const past=x.kind==="task"?x.done:(x.end!=null&&x.end<=nowMin);
    const live=x.kind!=="task"&&x.start<=nowMin&&x.end>nowMin;
    if(x.kind==="task"){
      return `<div class="agenda-row kind-task ${past?"past":""}">
        <div class="agenda-time">${minutesLabel(x.start)}</div>
        <button class="check ${x.done?"on":""}" data-toggle-task="${esc(x.id)}" aria-label="Mark ${esc(x.title)} done"></button>
        <div class="agenda-main" data-edit-task="${esc(x.id)}"><b>${esc(x.title)}</b><small>${esc(x.subtitle)}</small></div>
      </div>`;
    }
    return `<div class="agenda-row kind-${x.kind} ${past?"past":""} ${live?"live":""}">
      <div class="agenda-time">${minutesLabel(x.start)}<small>${minutesLabel(x.end)}</small></div>
      <div class="agenda-bar"></div>
      <div class="agenda-main"><b>${esc(x.title)}</b><small>${esc(x.subtitle)}</small>${x.venue?venueLink(x.venue):""}</div>
    </div>`;
  }

  function render(){
    const now=new Date();
    const items=itemsOnDate(now);
    const overdue=state.tasks.filter(isOverdue);
    const soon=state.tasks.filter(t=>!t.done&&!isOverdue(t)&&t.dueDate!==isoDate(now))
      .sort((a,b)=>taskDateTime(a)-taskDateTime(b)).slice(0,4);
    const reminders=currentReminders().length;

    el.innerHTML=`
      ${pageHeader(greeting(),{
        eyebrow:`${now.toLocaleDateString("en-SG",{weekday:"long",day:"numeric",month:"long"})}${academicWeek(now)?` · ${academicWeek(now).label}`:""}`,
        actions:`<button class="icon-btn" data-go="more" aria-label="Settings">${icon(SETTINGS_ICON)}</button><button class="icon-btn" id="todayBell" aria-label="Reminders">${icon("M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0")}${reminders?`<span class="dot">${reminders}</span>`:""}</button>`
      })}
      ${overdue.length?`<button class="banner warn" data-go="tasks">${icon("M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",18)}<span><b>${overdue.length} overdue task${overdue.length===1?"":"s"}</b> · ${esc(overdue[0].title)}${overdue.length>1?" and more":""}</span>${icon("M9 18l6-6-6-6",18)}</button>`:""}
      <div class="today-grid">
        <div class="today-col">
          ${nextCard()}
          <div class="card">
            <div class="card-head"><h3>Today</h3><button class="link" data-go="schedule">Schedule</button></div>
            ${items.length?`<div class="agenda">${items.map(x=>agendaRow(x,now)).join("")}</div>`:`<div class="empty-inline">Nothing scheduled today.</div>`}
          </div>
        </div>
        <div class="today-col">
          <div class="card shuttle-card">
            <div class="card-head"><h3>Nearby buses</h3><button class="link" id="shuttleMap">Map</button></div>
            <div id="shuttleBody"><div class="empty-inline"><span class="spinner sm"></span>Finding stops near you…</div></div>
          </div>
          <div class="card">
            <div class="card-head"><h3>Due soon</h3><button class="link" id="todayAddTask">+ Add</button></div>
            ${soon.length?`<div class="task-list compact">${soon.map(taskRowHTML).join("")}</div>`:`<div class="empty-inline">Nothing else due. Nice.</div>`}
          </div>
        </div>
      </div>`;

    $("#todayBell",el).onclick=openReminders;
    $("#todayAddTask",el).onclick=()=>openTaskForm();
    $("#shuttleMap",el).onclick=()=>go("map",shuttleStop?{stop:shuttleStop.code}:{});
    bindTaskRows(el);
    renderShuttles();
  }

  // Nearest stops, NUS shuttle and public bus together, each listing every
  // service there (shuttles and buses mixed) by next arrival.
  async function renderShuttles(){
    const body=$("#shuttleBody",el);
    if(!body) return;
    let stops;
    try{
      stops=await nearbyBusStops(await getPosition(),3);
    }catch(err){
      stops=[];
    }
    if(!stops.length){
      // No location (or nothing nearby): show the stop last looked at, or Central Library.
      const saved=localStorage.getItem("nus_fav_stop")||"CLB";
      stops=[NUS_STOPS.find(s=>s.code===saved)||NUS_STOPS[0]];
    }
    shuttleStop=stops[0];
    const boards=await Promise.all(stops.map(async s=>{
      const {rows,shuttleBlocked,nusStop,pubStop}=await combinedArrivals(s);
      const sub=[nusStop?"NUS shuttle":"",pubStop?`Bus stop ${pubStop.code}`:""].filter(Boolean).join(" · ");
      return `<div class="stop-board">
        <button class="stop-title" data-go="map" data-params='${esc(JSON.stringify({stop:s.code}))}'>
          <span class="stop-dot ${s.type==="public"?"public":""}"></span><span class="stop-name"><b>${esc(s.name)}</b><small>${sub}</small></span>${s.distance!=null?`<small>${distanceLabel(s.distance)}</small>`:""}
        </button>
        ${rows.length?etaRowsHTML(rows.slice(0,4)):`<div class="empty-inline">No buses right now.</div>`}
        ${rows.length>4?`<button class="link more-link" data-go="map" data-params='${esc(JSON.stringify({stop:s.code}))}'>${rows.length-4} more service${rows.length-4===1?"":"s"}</button>`:""}
        ${shuttleBlocked?`<button class="btn secondary full" data-go="map" data-params='${esc(JSON.stringify({stop:s.code}))}'>See live shuttle times</button>`:""}
      </div>`;
    }));
    if(activeView==="today" && $("#shuttleBody",el)) $("#shuttleBody",el).innerHTML=boards.join("");
  }

  return {
    title:"Today",
    mount(container){ el=container; },
    show(){
      render();
      clearInterval(shuttleTimer); clearInterval(clockTimer);
      shuttleTimer=setInterval(()=>{ if(activeView==="today"&&!document.hidden) renderShuttles(); },30000);
      clockTimer=setInterval(()=>{ if(activeView==="today"&&!document.hidden&&!document.body.classList.contains("sheet-open")) render(); },60000);
    },
    refresh(){ render(); }
  };
})();

/* ---------- Reminders sheet (also used from More) ---------- */

function openReminders(){
  const items=currentReminders();
  const status=notificationStatus();
  openModal(`<h2>Reminders</h2>
    <p class="subtle">Tasks remind you 7 days and 1 day before they're due. Activities remind you the day before.</p>
    <div class="list">${items.length?items.map(x=>`
      <div class="list-row"><div><b>${esc(x.kind==="Task · overdue"?"⚠ ":"")}${esc(x.title)}</b><small>${esc(x.kind)}${x.deadline?` · ${esc(x.deadline)}`:""}</small></div></div>`).join("")
      :`<div class="empty-inline">No reminders right now.</div>`}</div>
    ${status==="granted"?`<p class="small-help">Notifications are on for this device.</p>`:
      `<button class="btn primary full" id="enableReminders">Turn on notifications</button>`}`);
  $("#enableReminders")?.addEventListener("click",async()=>{ if(await enableWebPushNotifications()) closeModal(); });
}
