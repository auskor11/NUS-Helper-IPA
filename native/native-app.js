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
        body:x.deadline?`${x.title} · Deadline: ${x.deadline}`:`${x.title} · ${x.body}`,
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

  LocalNotifications.addListener("localNotificationActionPerformed",e=>{
    const href=e?.notification?.extra?.href;
    if(href && location.pathname!==href) location.href=href;
  });
})();
