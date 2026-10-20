/* NUS Helper IPA - native replacements for browser-only features.
 * Loaded right after shared.js, so it can replace shared.js's global functions
 * before any page script runs.
 *
 * - Web Push needs a service worker, which iOS apps can't use. Reminders are
 *   instead scheduled on the phone as local notifications, using the same
 *   rules as the web app (tasks: 7 days + 1 day before + when overdue,
 *   activities: 1 day before) and the same wording as the push server.
 * - The "Install app" button is hidden: this already is the app.
 */
(function(){
  const cap=window.Capacitor;
  if(!cap?.isNativePlatform?.()) return;

  const LocalNotifications=cap.Plugins.LocalNotifications;
  const MAX_PENDING=60; // iOS keeps at most 64 pending local notifications.
  let permission="default";

  setupInstall=function(){
    const btn=$("#installBtn");
    if(btn) btn.hidden=true;
  };

  notificationStatus=function(){ return permission; };

  function numericId(key){
    let h=0;
    for(const c of key) h=(h*31+c.charCodeAt(0))|0;
    return Math.abs(h)||1;
  }

  async function refreshPermission(){
    try{
      const r=await LocalNotifications.checkPermissions();
      permission=r.display==="granted"?"granted":r.display==="denied"?"denied":"default";
    }catch(e){ console.warn("Notification permission check failed",e); }
    return permission;
  }

  async function scheduleReminders(){
    if(await refreshPermission()!=="granted") return;
    const now=Date.now();
    const upcoming=buildNotificationItems()
      .filter(x=>x.when>now+5000)
      .sort((a,b)=>a.when-b.when)
      .slice(0,MAX_PENDING);

    const pending=await LocalNotifications.getPending();
    if(pending.notifications.length){
      await LocalNotifications.cancel({notifications:pending.notifications.map(n=>({id:n.id}))});
    }
    if(!upcoming.length) return;

    await LocalNotifications.schedule({
      notifications:upcoming.map(x=>({
        id:numericId(x.id),
        title:x.kind==="Task · overdue"?"⚠ Overdue task":`🔔 ${x.kind}`,
        body:x.kind.startsWith("Assessment")?`${x.title} · ${x.deadline}`:x.deadline?`${x.title} · Deadline: ${x.deadline}`:`${x.title} · ${x.body}`,
        schedule:{at:new Date(x.when),allowWhileIdle:true},
        extra:{href:x.href}
      }))
    });
  }

  let rescheduleTimer=null;
  function queueReschedule(){
    clearTimeout(rescheduleTimer);
    rescheduleTimer=setTimeout(()=>scheduleReminders().catch(e=>console.warn("Scheduling reminders failed",e)),1000);
  }

  enableWebPushNotifications=async function(){
    if(!window.nusFirebase?.user){
      toast("Please sign in before enabling notifications.");
      return false;
    }
    try{
      const r=await LocalNotifications.requestPermissions();
      if(r.display!=="granted"){
        toast("Notifications are off. Turn them on in iPhone Settings → NUS Companion.");
        return false;
      }
      permission="granted";
      await scheduleReminders();
      toast("Reminders enabled on this iPhone.");
      return true;
    }catch(e){
      console.error("Enabling notifications failed",e);
      toast(`Notification setup failed: ${e.message||e}`);
      return false;
    }
  };

  // Keep the scheduled reminders in step with the data: after local edits,
  // after cloud/realtime updates, and whenever the app comes back to front.
  const webSave=save;
  save=async function(...args){
    const result=await webSave.apply(this,args);
    queueReschedule();
    return result;
  };
  window.addEventListener("nus-cloud-state-applied",queueReschedule);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) queueReschedule(); });

  refreshPermission();

  /* ---------- Home screen widgets ---------- */
  // Sends the schedule, NUS stops and shuttle routes to the widgets through
  // the shared App Group (ios/App/App/Trip/WidgetBridgePlugin.swift).
  const WidgetBridge=cap.Plugins.WidgetBridge;
  let venueCoords={};
  try{ venueCoords=JSON.parse(localStorage.getItem("nus_venue_coords")||"{}"); }catch{}
  let twinCodes=null;

  async function coordsFor(name){
    if(!name) return null;
    if(name in venueCoords) return venueCoords[name];
    try{
      const p=await resolveVenue(name);
      venueCoords[name]=p&&p.lat!=null?{lat:p.lat,lng:p.lng}:null;
      localStorage.setItem("nus_venue_coords",JSON.stringify(venueCoords));
      return venueCoords[name];
    }catch{ return null; } // offline: try again next time
  }

  async function pushWidgetData(){
    if(!WidgetBridge || !window.nusFirebase?.user) return;
    const hhmm=v=>minutesToInput(timeToMinutes(v));
    const items=[];
    // Lessons go in as dated classes for the next four weeks, so the widgets
    // follow odd/even-week classes, recess and exam weeks (lessonOccursOnDate).
    const today=new Date(); today.setHours(12,0,0,0);
    for(const l of state.lessons){
      const c=l.venueLat!=null?{lat:l.venueLat,lng:l.venueLng}:await coordsFor(l.venue);
      for(let i=0;i<28;i++){
        const date=addDays(today,i);
        if(!lessonOccursOnDate(l,date)) continue;
        items.push({kind:"lesson",title:l.module,subtitle:`${l.lessonType||"Class"}${l.classNo&&l.classNo!=="TBC"?` ${l.classNo}`:""}`,
          day:null,date:isoDate(date),start:hhmm(l.startTime),end:hhmm(l.endTime),venue:l.venue||"",lat:c?.lat??null,lng:c?.lng??null});
      }
    }
    for(const a of state.activities){
      const c=a.venueLat!=null?{lat:a.venueLat,lng:a.venueLng}:await coordsFor(a.venue);
      items.push({kind:"activity",title:a.name,subtitle:a.club||"Activity",day:a.recurring?a.day:null,date:a.recurring?null:a.date,
        start:hhmm(a.startTime),end:hhmm(a.endTime),venue:a.venue||"",lat:c?.lat??null,lng:c?.lng??null});
    }
    if(!twinCodes){
      twinCodes={};
      for(const s of NUS_STOPS){ const t=await publicStopNear(s); twinCodes[s.code]=t?.code||null; }
    }
    const stops=NUS_STOPS.map(s=>({code:s.code,name:s.name,lat:s.lat,lng:s.lng,publicCode:twinCodes[s.code]}));
    await WidgetBridge.update({data:JSON.stringify({updatedAt:Date.now(),items:items.filter(i=>i.start&&i.end),stops,routes:SHUTTLE_ROUTES})});
  }

  let widgetTimer=null;
  const queueWidgets=()=>{ clearTimeout(widgetTimer); widgetTimer=setTimeout(()=>pushWidgetData().catch(e=>console.warn("Widget update failed",e)),2000); };
  window.addEventListener("nus-cloud-state-applied",queueWidgets);
  window.addEventListener("nus-data-changed",queueWidgets);

  // Widget taps open nuscompanion://open/<route>, e.g. open/map?stop=CLB.
  const openDeepLink=url=>{
    const m=String(url||"").match(/^nuscompanion:\/\/open\/(.+)$/);
    if(!m) return;
    // Same link twice (e.g. tapping the Dynamic Island while on the trip)
    // doesn't fire hashchange, so handle the route directly.
    if(location.hash===`#/${m[1]}`) handleRoute(); else location.hash=`#/${m[1]}`;
  };
  cap.Plugins.App?.addListener("appUrlOpen",e=>openDeepLink(e.url));
  cap.Plugins.App?.getLaunchUrl().then(r=>openDeepLink(r?.url)).catch(()=>{});

  LocalNotifications.addListener("localNotificationActionPerformed",e=>{
    const href=e?.notification?.extra?.href;
    if(href && location.pathname!==href) location.href=href;
  });
})();
