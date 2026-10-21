/* Map tab: one search bar for venues, NUS shuttle stops, public bus stops and
 * any place in Singapore. Selecting something opens a panel at the bottom of
 * the map with live bus arrivals and directions - no page changes.
 */

views.map=(()=>{
  let el=null, map=null, ready=false;
  let nusMarkers=new Map(), nusLayer=null, publicLayer=null, savedLayer=null, pinMarker=null, meMarker=null, watchId=null;
  let selected=null, refreshTimer=null, searchTimer=null, pendingParams=null, routeLayer=null;
  let resultsLayer=null, lastSearch=null, baseLayer=null, baseStyle=null;

  // Dynamic Island / lock screen trip tracking (iOS app only).
  // Native plugin from ios/App/App/Trip (NUS Helper IPA); absent on the web.
  const TripActivity=isNativeApp()?window.Capacitor?.Plugins?.TripActivity||null:null;

  // "Show on widget": sets the stop shown by Bus stop widgets that follow the
  // app (WidgetBridgePlugin.pinStop in NUS Helper IPA). iOS app only.
  const WidgetBridge=isNativeApp()?window.Capacitor?.Plugins?.WidgetBridge||null:null;
  const WIDGET_ICON="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z";
  const pinnedWidgetKey=()=>{ try{ return localStorage.getItem("nus_widget_stop")||""; }catch{ return ""; } };

  // {id, name, isNUS, publicCode} for a stop: an NUS stop carries the public
  // stop on the same pole, and a public stop next to an NUS stop becomes that
  // NUS stop, so the widget shows shuttles and public buses together.
  async function widgetStopFor({code,name,lat,lng,nus}){
    if(nus){
      const s=NUS_STOPS.find(x=>x.code===code);
      const twin=s?await publicStopNear(s):null;
      return {id:code,name,isNUS:true,publicCode:twin?.code||null};
    }
    const n=NUS_STOPS.find(x=>distanceM(x,{lat,lng})<45);
    return {id:n?n.code:code,name,isNUS:!!n,publicCode:code};
  }

  function widgetButtonHTML(attrs,key){
    if(!WidgetBridge) return "";
    const on=pinnedWidgetKey()===key;
    return `<button class="chip widget-btn ${on?"on":""}" ${attrs}>${icon(on?"M20 6 9 17l-5-5":WIDGET_ICON,14)}${on?"On your widget":"Show on widget"}</button>`;
  }

  // From a route step, `ride` = {service, to} puts that bus first on the widget.
  async function pinWidgetStop(src,btn,ride=null){
    try{
      const info=await widgetStopFor(src);
      await WidgetBridge.pinStop(ride?{...info,services:[String(ride.service)],to:ride.to}:info);
      try{ localStorage.setItem("nus_widget_stop",src.code); }catch{}
      $$(".widget-btn.on",el).forEach(b=>{ b.classList.remove("on"); b.innerHTML=`${icon(WIDGET_ICON,14)}Show on widget`; });
      if(btn){ btn.classList.add("on"); btn.innerHTML=`${icon("M20 6 9 17l-5-5",14)}On your widget`; }
      toast(ride?`Widget: bus ${ride.service} at ${info.name}`:`Bus stop widget: ${info.name}`);
    }catch(err){ toast(`Couldn't update the widget: ${err.message||err}`); }
  }
  let tripActive=false;
  TripActivity?.addListener("tripEnded",()=>{ tripActive=false; clearActiveTrip(); $$("#tripBtn",el).forEach(b=>{ b.textContent="Start trip"; b.classList.replace("danger-soft","primary"); }); });
  // After a restart, keep the saved trip only if the Live Activity is still running.
  // The native tracker resumes a trip that outlived the app being closed; if
  // this device lost its copy of the trip, rebuild it from the native plan.
  // Resolves once the native side has said whether a trip is running, so a
  // Dynamic Island tap at launch doesn't decide too early.
  const tripChecked=!TripActivity?Promise.resolve():TripActivity.isActive().then(r=>{
    tripActive=!!r?.active;
    if(!tripActive){ if(loadActiveTrip()) clearActiveTrip(); return; }
    const saved=loadActiveTrip();
    if(r.plan){
      // The native plan is the source of truth for the trip that's running.
      try{ if(!saved||saved.native) saveActiveTrip({...tripFromNativePlan(JSON.parse(r.plan)),native:true}); }catch(err){ console.warn("Couldn't rebuild the trip",err); }
    }else if(!saved){
      saveActiveTrip({kind:"orphan",name:r.destination||"your destination"});
    }
    renderTripBar();
  }).catch(err=>console.warn("Trip check failed",err));

  function tripFromNativePlan(plan){
    const last=plan.legs.at(-1);
    const dest={type:"place",code:plan.destination,name:"",lat:last.toLat,lng:last.toLng};
    if(plan.mode!=="transit") return {kind:"street",mode:plan.mode,dest};
    let prev=null;
    const legs=plan.legs.map(l=>{
      const first=l.stops?.[0];
      const from=first?{name:first.name,code:l.code||"",lat:first.lat,lng:first.lng}:prev||{name:"your location",code:"",lat:l.path?.[0]?.[0],lng:l.path?.[0]?.[1]};
      const to={name:l.toName,code:"",lat:l.toLat,lng:l.toLng};
      prev=to;
      const pts=l.path?.length?l.path:[];
      const dist=pts.slice(1).reduce((n,p,i)=>n+distanceM({lat:pts[i][0],lng:pts[i][1]},{lat:p[0],lng:p[1]}),0)||(l.duration||0)*1.3;
      return {mode:l.mode,line:l.line||"",headsign:"",from,to,stops:Math.max(1,(l.stops?.length||1)-1),duration:l.duration||0,distance:dist,
        path:l.path?.length?l.path:(l.stops||[]).map(x=>[x.lat,x.lng])};
    });
    return {kind:"transit",name:plan.destination,commute:{id:"trip",name:`To ${plan.destination}`,to:{name:plan.destination,lat:last.toLat,lng:last.toLng},legs}};
  }
  if(!TripActivity && loadActiveTrip()) clearActiveTrip();
  window.addEventListener("nus-trip-changed",()=>renderTripBar());

  function renderTripBar(){
    const bar=$("#tripBar",el); if(!bar) return;
    const t=loadActiveTrip();
    bar.hidden=!t;
    if(t) $("span",bar).innerHTML=`<b>Trip in progress</b> · to ${esc(activeTripName(t))}`;
  }

  // Reopen the trip that's running (from the trip bar, Today or the island).
  async function openActiveTrip(){
    await tripChecked;
    const t=loadActiveTrip();
    if(!t){ toast("No trip in progress."); return; }
    if(t.kind==="transit") openCommute(t.commute,{trip:true});
    else if(t.kind==="orphan") openOrphanTrip(t);
    else showRoute(t.dest,{mode:t.mode});
  }

  // The island is still up but the trip's details were lost.
  function openOrphanTrip(t){
    clearInterval(refreshTimer); clearRoute();
    selected=t;
    openPanel(`<p class="kicker">TRIP IN PROGRESS</p><h2>To ${esc(t.name)}</h2>
      <p class="subtle">The route details for this trip weren't saved, so they can't be shown. The Dynamic Island keeps following it.</p>
      <div class="two route-actions"><button class="btn secondary" id="orphanRoute">Plan again</button><button class="btn danger-soft" id="tripEnd">End trip</button></div>`);
    $("#tripEnd",el).onclick=async()=>{ try{ await TripActivity?.end(); }catch{} tripActive=false; clearActiveTrip(); closePanel(); toast("Trip ended"); };
    $("#orphanRoute",el).onclick=()=>{ $("#mapSearch",el).value=t.name; $("#mapSearch",el).dispatchEvent(new Event("input")); closePanel(); };
  }

  /* ---------- Markers ---------- */

  const nusIcon=(on=false)=>L.divIcon({className:"",html:`<div class="mk-nus ${on?"on":""}">${icon("M8 6v6M16 6v6M2 12h20M7 18h.01M17 18h.01M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z",14)}</div>`,iconSize:[28,28],iconAnchor:[14,14]});
  const publicIcon=()=>L.divIcon({className:"",html:`<div class="mk-public">${icon("M8 6v6M16 6v6M2 12h20M7 18h.01M17 18h.01M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z",12)}</div>`,iconSize:[22,22],iconAnchor:[11,11]});
  const pinIcon=()=>L.divIcon({className:"",html:`<div class="mk-pin"></div>`,iconSize:[30,40],iconAnchor:[15,38]});
  const meIcon=()=>L.divIcon({className:"",html:`<div class="mk-me"><span></span></div>`,iconSize:[22,22],iconAnchor:[11,11]});

  function initMap(){
    map=L.map($("#mapCanvas",el),{zoomControl:false,attributionControl:true,maxZoom:19}).setView([NUS_CENTER.lat,NUS_CENTER.lng],16);
    applyBaseStyle();
    publicLayer=L.layerGroup();
    nusLayer=L.layerGroup();
    savedLayer=L.layerGroup().addTo(map);
    applyLayers();
    renderSaved();
    // Long-press (or right-click) anywhere to drop a pin you can save.
    // iOS doesn't send contextmenu for a long press, so time touches ourselves.
    map.on("contextmenu",e=>dropPin(e.latlng));
    const canvas=$("#mapCanvas",el);
    let pressTimer=null, pressStart=null;
    canvas.addEventListener("touchstart",e=>{
      if(e.touches.length!==1) return clearTimeout(pressTimer);
      const t=e.touches[0];
      pressStart={x:t.clientX,y:t.clientY};
      clearTimeout(pressTimer);
      pressTimer=setTimeout(()=>{
        navigator.vibrate?.(10);
        dropPin(map.mouseEventToLatLng({clientX:pressStart.x,clientY:pressStart.y}));
      },550);
    },{passive:true});
    canvas.addEventListener("touchmove",e=>{
      const t=e.touches[0];
      if(pressStart && Math.hypot(t.clientX-pressStart.x,t.clientY-pressStart.y)>10) clearTimeout(pressTimer);
    },{passive:true});
    ["touchend","touchcancel"].forEach(ev=>canvas.addEventListener(ev,()=>clearTimeout(pressTimer),{passive:true}));

    for(const s of NUS_STOPS){
      const m=L.marker([s.lat,s.lng],{icon:nusIcon(),title:s.name,zIndexOffset:500}).addTo(nusLayer);
      m.on("click",()=>selectStop(s));
      nusMarkers.set(s.code,m);
    }
    map.on("moveend",renderPublicStops);
    map.on("moveend",()=>{
      const b=$("#searchArea",el);
      if(b && lastSearch && map.getCenter().distanceTo(lastSearch.center)>300) b.hidden=false;
    });
    map.on("click",()=>{ hideResults(); $("#layersMenu",el).hidden=true; });
    loadPublicStops().then(renderPublicStops);
    ready=true;
  }

  /* ---------- Base map ---------- */
  // Vector maps from OpenFreeMap's "liberty" style (no key needed). Dark mode
  // is the same map inverted with hues kept (styles.css .map-dark), which keeps
  // far more detail than OpenFreeMap's own dark styles. Falls back to plain
  // OpenStreetMap tiles where WebGL isn't available.

  const MAP_STYLES={auto:"Match app theme",liberty:"Light",dark:"Dark",classic:"Classic"};

  function mapStylePref(){ try{ return localStorage.getItem("nus_map_style")||"auto"; }catch{ return "auto"; } }

  // MapLibre is ~850 KB, so it loads the first time the map is opened rather
  // than at app start-up.
  let mapLibrePromise=null, mapLibreFailed=false;
  function loadMapLibre(){
    if(L.maplibreGL) return Promise.resolve();
    if(mapLibrePromise) return mapLibrePromise;
    const add=(tag,attrs)=>new Promise((resolve,reject)=>{
      const n=Object.assign(document.createElement(tag),attrs);
      n.onload=resolve; n.onerror=()=>reject(new Error(`Couldn't load ${attrs.src||attrs.href}`));
      document.head.appendChild(n);
    });
    mapLibrePromise=Promise.all([
      add("link",{rel:"stylesheet",href:"/vendor/maplibre/maplibre-gl.css"}),
      add("script",{src:"/vendor/maplibre/maplibre-gl.js"}).then(()=>add("script",{src:"/vendor/maplibre/leaflet-maplibre-gl.js"}))
    ]).catch(err=>{ console.warn(err); mapLibrePromise=null; throw err; });
    return mapLibrePromise;
  }

  function applyBaseStyle(){
    if(!map) return;
    const pref=mapStylePref();
    let style=pref==="auto" ? (document.body.classList.contains("light")?"liberty":"dark") : pref;
    if(style!=="classic" && !L.maplibreGL){
      if(!mapLibreFailed){
        loadMapLibre().then(applyBaseStyle).catch(()=>{ mapLibreFailed=true; applyBaseStyle(); });
        return;
      }
      style="classic"; // offline: plain tiles until the next launch
    }
    if(style!=="classic" && window.maplibregl?.supported?.()===false) style="classic";
    if(style===baseStyle) return;
    if(baseLayer) map.removeLayer(baseLayer);
    baseStyle=style;
    if(style==="classic"){
      baseLayer=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
        maxZoom:19,
        attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);
    }else{
      baseLayer=L.maplibreGL({
        style:"https://tiles.openfreemap.org/styles/liberty",
        attribution:'<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);
      baseLayer.getContainer?.()?.classList.toggle("map-dark",style==="dark");
      // The app draws its own bus stops; keep the map's MRT and airport icons only.
      const gl=baseLayer.getMaplibreMap();
      gl.on("style.load",()=>{
        for(const l of gl.getStyle().layers.filter(l=>l.id.startsWith("poi"))){
          const f=gl.getFilter(l.id);
          gl.setFilter(l.id,f?["all",f,["!=",["get","class"],"bus"]]:["!=",["get","class"],"bus"]);
        }
      });
    }
    baseLayer.bringToBack?.();
  }

  /* ---------- Layers ---------- */

  function layerPrefs(){
    try{ return {nus:true,public:true,...JSON.parse(localStorage.getItem("nus_map_layers")||"{}")}; }
    catch{ return {nus:true,public:true}; }
  }

  function applyLayers(){
    const prefs=layerPrefs();
    prefs.nus?nusLayer.addTo(map):nusLayer.remove();
    prefs.public?publicLayer.addTo(map):publicLayer.remove();
    $("#layersBtn",el)?.classList.toggle("dim",!prefs.nus&&!prefs.public);
  }

  function toggleLayersMenu(){
    const menu=$("#layersMenu",el);
    if(!menu.hidden){ menu.hidden=true; return; }
    const prefs=layerPrefs();
    menu.innerHTML=`<p class="kicker">SHOW ON MAP</p>
      <button class="layer-row" data-layer="nus"><span class="mk-nus small"></span><span>NUS shuttle stops</span><span class="switch ${prefs.nus?"on":""}"></span></button>
      <button class="layer-row" data-layer="public"><span class="mk-public"></span><span>Public bus stops</span><span class="switch ${prefs.public?"on":""}"></span></button>
      <p class="kicker">MAP STYLE</p>
      <div class="style-options">${Object.entries(MAP_STYLES).map(([k,l])=>`<button class="chip ${mapStylePref()===k?"on":""}" data-style="${k}">${l}</button>`).join("")}</div>`;
    menu.hidden=false;
    $$("[data-style]",menu).forEach(b=>b.onclick=()=>{
      try{ localStorage.setItem("nus_map_style",b.dataset.style); }catch{}
      $$("[data-style]",menu).forEach(o=>o.classList.toggle("on",o===b));
      applyBaseStyle();
    });
    $$("[data-layer]",menu).forEach(b=>b.onclick=()=>{
      const next=layerPrefs(); next[b.dataset.layer]=!next[b.dataset.layer];
      localStorage.setItem("nus_map_layers",JSON.stringify(next));
      $(".switch",b).classList.toggle("on",next[b.dataset.layer]);
      applyLayers();
    });
  }

  /* ---------- Saved places ---------- */

  const savedIcon=p=>L.divIcon({className:"",html:`<div class="mk-saved">${icon((PLACE_ICONS[p.icon]||PLACE_ICONS.star).path,15)}</div>`,iconSize:[30,30],iconAnchor:[15,15]});

  function renderSaved(){
    if(!savedLayer) return;
    savedLayer.clearLayers();
    for(const p of state.places||[]){
      L.marker([p.lat,p.lng],{icon:savedIcon(p),title:p.name,zIndexOffset:800})
        .on("click",()=>selectPlace(savedAsPlace(p))).addTo(savedLayer);
    }
    const chips=$("#savedChips",el);
    if(chips) chips.innerHTML=commuteChipsHTML()+(state.places||[]).map(p=>`<button class="chip solid saved-chip" data-saved="${esc(p.id)}">${icon((PLACE_ICONS[p.icon]||PLACE_ICONS.star).path,14)}${esc(p.name)}</button>`).join("");
    $$("[data-saved]",el).forEach(b=>b.onclick=()=>{ const p=state.places.find(x=>x.id===b.dataset.saved); if(p) selectPlace(savedAsPlace(p)); });
    $$("[data-commute]",el).forEach(b=>b.onclick=()=>{ const c=(state.commutes||[]).find(x=>x.id===b.dataset.commute); if(c) openCommute(c); });
  }

  const savedAsPlace=p=>({type:"saved",id:p.id,code:p.name,name:p.address||"",icon:p.icon,lat:p.lat,lng:p.lng});

  async function dropPin(latlng){
    const p={type:"place",code:"Dropped pin",name:"Finding address…",lat:latlng.lat,lng:latlng.lng};
    selectPlace(p);
    const r=await reverseGeocode(latlng.lat,latlng.lng);
    if(selected!==p) return;
    p.code=r.title; p.name=r.address;
    const panel=$("#mapPanel",el);
    $("h2",panel).textContent=r.title;
    const sub=$(".place-address",panel); if(sub) sub.textContent=r.address;
  }

  function openSaveSheet(p){
    const existing=p.type==="saved"?state.places.find(x=>x.id===p.id):null;
    let chosen=existing?.icon||(state.places.some(x=>x.icon==="home")?"star":"home");
    const suggested=existing?.name||(chosen==="home"?"Home":p.code==="Dropped pin"?"":p.code);
    openModal(`<h2>${existing?"Edit saved place":"Save place"}</h2>
      <p class="subtle">${esc(p.name||`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)}</p>
      <form class="form" id="saveForm">
        <div class="icon-pick">${Object.entries(PLACE_ICONS).map(([k,v])=>`<button type="button" class="icon-opt ${k===chosen?"on":""}" data-icon="${k}">${icon(v.path,20)}<span>${v.label}</span></button>`).join("")}</div>
        <input class="input big" name="name" value="${esc(suggested)}" placeholder="Name, e.g. Home" required>
        <button class="btn primary full">${existing?"Save changes":"Save"}</button>
        ${existing?`<button type="button" class="btn danger-soft full" id="removeSaved">Remove</button>`:""}
      </form>`);
    const form=$("#saveForm");
    $$(".icon-opt",form).forEach(b=>b.onclick=()=>{
      const prevLabel=PLACE_ICONS[chosen].label;
      chosen=b.dataset.icon;
      $$(".icon-opt",form).forEach(x=>x.classList.toggle("on",x===b));
      // Fill in the name when it was still the previous icon's default.
      if(!form.name.value.trim()||form.name.value===prevLabel) form.name.value=chosen==="star"?"":PLACE_ICONS[chosen].label;
    });
    form.onsubmit=e=>{
      e.preventDefault();
      const name=String(new FormData(form).get("name")).trim();
      if(existing) Object.assign(existing,{name,icon:chosen});
      else state.places=[...(state.places||[]),{id:uid(),name,icon:chosen,lat:p.lat,lng:p.lng,address:p.name&&p.name!=="Finding address…"?p.name:""}];
      closeModal(); save(); toast(existing?"Saved":`${name} saved`);
      renderSaved();
      const saved=existing||state.places.at(-1);
      selectPlace(savedAsPlace(saved));
    };
    $("#removeSaved")?.addEventListener("click",async()=>{
      if(!await confirmSheet(`Remove “${existing.name}”?`,{confirm:"Remove"})) return;
      state.places=state.places.filter(x=>x.id!==existing.id);
      save(); renderSaved(); closePanel(); toast("Removed");
    });
  }

  // Public stops only when zoomed in, so the map stays readable.
  async function renderPublicStops(){
    publicLayer.clearLayers();
    if(map.getZoom()<15 || !layerPrefs().public) return;
    const bounds=map.getBounds().pad(0.1);
    for(const s of await loadPublicStops()){
      if(!bounds.contains([s.lat,s.lng])) continue;
      if(NUS_STOPS.some(n=>distanceM(n,s)<45)) continue;
      L.marker([s.lat,s.lng],{icon:publicIcon(),title:s.name}).on("click",()=>selectStop(s)).addTo(publicLayer);
    }
  }

  function startLocation(){
    if(watchId!=null || !navigator.geolocation) return;
    watchId=navigator.geolocation.watchPosition(p=>{
      lastPosition={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,at:Date.now()};
      if(!meMarker) meMarker=L.marker([lastPosition.lat,lastPosition.lng],{icon:meIcon(),interactive:false,zIndexOffset:2000}).addTo(map);
      else meMarker.setLatLng([lastPosition.lat,lastPosition.lng]);
    },()=>{},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});
  }

  /* ---------- Panel ---------- */

  /* Motion: the panel grows or shrinks to fit new content instead of
   * jumping, new screens slide in (forward from the right, back from the
   * left), and the panel slides away when closed. */
  const EASE="cubic-bezier(.22,.9,.3,1)";
  const calm=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
  let panelTargetH=null, closing=null, slideNext=null;

  // Height the panel is settling at (mid-animation offsetHeight lags behind).
  function panelHeight(){ return panelTargetH ?? $("#mapPanel",el).offsetHeight; }

  // Runs `change` (which replaces the panel's content) with the height
  // change animated and the new content in `target` sliding or fading in.
  function morphPanel(change,target,dir=null){
    const p=$("#mapPanel",el);
    const animate=!p.hidden&&!closing&&!calm();
    const from=animate?p.getBoundingClientRect().height:0;
    change();
    if(!animate) return;
    p.getAnimations().forEach(a=>{ if(a.id==="panel-h") a.cancel(); });
    const to=p.getBoundingClientRect().height;
    if(Math.abs(to-from)>2){
      panelTargetH=to;
      const a=p.animate([{height:`${from}px`},{height:`${to}px`}],{duration:340,easing:EASE});
      a.id="panel-h";
      a.onfinish=a.oncancel=()=>{ if(panelTargetH===to) panelTargetH=null; };
    }
    if(dir&&target){
      const x=dir==="back"?-36:dir==="forward"?36:0;
      target.animate([{opacity:0,transform:`translateX(${x}px)`},{opacity:1,transform:"none"}],{duration:dir==="fade"?220:320,easing:EASE});
    }
  }

  function setRouteBody(html){
    const body=$("#routeBody",el), dir=slideNext;
    slideNext=null;
    if(!body) return;
    morphPanel(()=>{ body.innerHTML=html; },body,dir);
    if(dir==="forward") $("#mapPanel",el).scrollTo({top:0,behavior:calm()?"auto":"smooth"});
  }

  function openPanel(html,{directions=false}={}){
    const p=$("#mapPanel",el);
    if(closing){ closing.cancel(); closing=null; p.hidden=true; p.style.pointerEvents=""; }
    const wasOpen=!p.hidden;
    morphPanel(()=>{
      p.classList.toggle("directions",directions);
      p.innerHTML=`<button class="panel-handle" aria-label="Collapse or expand"><span class="sheet-grabber"></span></button><button class="panel-close" aria-label="Close">${icon("M6 6l12 12M18 6 6 18",18)}</button>${html}`;
      p.classList.remove("collapsed");
    });
    if(wasOpen && !calm()) [...p.children].slice(2).forEach(c=>c.animate([{opacity:0,transform:"translateX(28px)"},{opacity:1,transform:"none"}],{duration:300,easing:EASE}));
    p.scrollTop=0;
    p.hidden=false;
    p.classList.remove("collapsed");
    el.classList.add("panel-open");
    el.classList.remove("panel-collapsed");
    $(".panel-close",p).onclick=closePanel;
    $(".panel-handle",p).onclick=()=>setCollapsed(!p.classList.contains("collapsed"));
  }

  // Collapsing shrinks the panel to its title (and trip summary) so the whole
  // map is visible; drag the top of the panel or tap the handle to toggle.
  function setCollapsed(on){
    const p=$("#mapPanel",el);
    if(p.hidden) return;
    morphPanel(()=>{
      p.classList.toggle("collapsed",on);
      el.classList.toggle("panel-collapsed",on);
      p.scrollTop=0;
    });
    setTimeout(()=>{ if(routeLayer) fitRouteToPanel(); },60);
  }

  function enablePanelDrag(){
    const p=$("#mapPanel",el);
    let startY=null, fromTop=false;
    p.addEventListener("touchstart",e=>{
      startY=e.touches[0].clientY;
      // Drag from the panel's top area, or anywhere when the panel is scrolled to the top.
      fromTop=e.touches[0].clientY-p.getBoundingClientRect().top<90 || p.scrollTop<=0;
    },{passive:true});
    p.addEventListener("touchend",e=>{
      if(startY==null) return;
      const dy=e.changedTouches[0].clientY-startY;
      startY=null;
      if(!fromTop) return;
      if(dy>50 && !p.classList.contains("collapsed")) setCollapsed(true);
      else if(dy<-40 && p.classList.contains("collapsed")) setCollapsed(false);
    },{passive:true});
  }

  // Centre a point in the part of the map the panel doesn't cover.
  function focusOn(p,zoom){
    map.setView([p.lat,p.lng],zoom,{animate:false});
    const panel=$("#mapPanel",el);
    const wide=matchMedia("(min-width:900px)").matches;
    if(!panel.hidden && !wide) map.panBy([0,panelHeight()/2],{animate:false});
  }

  function clearRoute(){
    if(routeLayer){ routeLayer.remove(); routeLayer=null; }
    el.classList.remove("routing");
  }

  function closePanel(){
    clearInterval(refreshTimer);
    clearRoute();
    const p=$("#mapPanel",el);
    el.classList.remove("panel-open");
    if(!p.hidden && !closing && !calm()){
      closing=p.animate([{transform:"none",opacity:1},{transform:"translateY(105%)",opacity:.6}],{duration:260,easing:"cubic-bezier(.4,0,.8,.4)",fill:"forwards"});
      const mine=closing;
      p.style.pointerEvents="none";
      mine.onfinish=()=>{ if(closing===mine){ closing=null; p.hidden=true; mine.cancel(); p.style.pointerEvents=""; } };
    }else if(!closing) p.hidden=true;
    if(selected?.type==="nus") nusMarkers.get(selected.code)?.setIcon(nusIcon());
    if(pinMarker){ pinMarker.remove(); pinMarker=null; }
    selected=null;
  }

  function distanceText(p){
    return lastPosition?` · ${distanceLabel(distanceM(lastPosition,p))} away`:"";
  }

  function walkButton(){
    return `<button class="btn primary full" id="walkHere">${icon("M3 11l19-9-9 19-2-8-8-2z",18)}Directions</button>`;
  }

  const TURN_ICONS={left:"M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v5",right:"M15 14l5-5-5-5M20 9H10a6 6 0 0 0-6 6v5",straight:"M12 19V5M5 12l7-7 7 7"};
  function stepIcon(st){
    if(st.type==="arrive") return icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",16);
    const dir=/left/.test(st.modifier)?"left":/right/.test(st.modifier)?"right":"straight";
    return icon(TURN_ICONS[dir],16);
  }

  const MODE_ICONS={
    transit:"M8 6v6M16 6v6M2 12h20M7 18h.01M17 18h.01M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3zM7 21l1-3M17 21l-1-3",
    walk:"M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9.5 22l2-7 2.5 2v5M8 12l1-4 4-1 3 4 3 1M10 8l-2 6",
    cycle:"M5.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 17.5V14l-3-3 4-3 2 3h2",
    drive:"M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M3 17v-5l2-5h14l2 5v5M3 12h18"
  };
  const MODE_LABELS={transit:"Transit",walk:"Walk",cycle:"Cycle",drive:"Drive"};

  function legIcon(leg){
    if(leg.mode==="WALK") return MODE_ICONS.walk;
    if(leg.mode==="BUS"||leg.mode==="SHUTTLE") return MODE_ICONS.transit;
    return "M8 3h8a4 4 0 0 1 4 4v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a4 4 0 0 1 4-4zM4 11h16M8 15h.01M16 15h.01M8 21l2-3M16 21l-2-3";
  }

  function drawPath(layers,fit=true){
    clearRoute();
    routeLayer=L.layerGroup(layers).addTo(map);
    el.classList.add("routing");
    if(fit) fitRouteToPanel();
  }

  function fitRouteToPanel(){
    if(!routeLayer) return;
    const pts=[];
    routeLayer.eachLayer(l=>l.getLatLngs&&pts.push(...l.getLatLngs().flat()));
    if(lastPosition) pts.push(L.latLng(lastPosition.lat,lastPosition.lng));
    if(!pts.length) return;
    const wide=matchMedia("(min-width:900px)").matches;
    const panelH=panelHeight();
    const opts={paddingTopLeft:[wide?460:40,wide?40:125],paddingBottomRight:[40,wide?40:panelH+20],maxZoom:18};
    // Glide to the route rather than jumping there.
    if(calm()) map.fitBounds(L.latLngBounds(pts),opts);
    else map.flyToBounds(L.latLngBounds(pts),{...opts,duration:.7,easeLinearity:.35});
  }

  // Directions with Transit (NUS shuttle, bus, MRT), Walk, Cycle and Drive.
  // Every mode loads at once and each result appears as soon as it arrives.
  async function showRoute(dest,{mode:startMode=null}={}){
    clearInterval(refreshTimer);
    clearRoute();
    selected=dest; // also when reopened from a trip, not via selectPlace
    const back=()=>dest.type==="nus"||dest.type==="public"?selectStop(dest):selectPlace(dest);
    const title=dest.type==="public"||dest.type==="nus"?dest.name:dest.code;
    openPanel(`<p class="kicker">DIRECTIONS</p><h2>${esc(title)}</h2>
      <p class="peek" id="routePeek"></p>
      <div class="mode-tabs" id="modeTabs">${Object.keys(MODE_LABELS).map(m=>`<button data-mode="${m}">${icon(MODE_ICONS[m],18)}<span>${MODE_LABELS[m]}</span><small>…</small></button>`).join("")}</div>
      <div id="routeBody"><div class="empty-inline"><span class="spinner sm"></span>Getting your location…</div></div>`,{directions:true});
    $$("#modeTabs button",el).forEach(b=>b.onclick=()=>pick(b.dataset.mode));
    const peek=text=>{ const p=$("#routePeek",el); if(p) p.textContent=text; };

    let from;
    try{ from=await getPosition({fresh:true}); startLocation(); }
    catch(err){
      setRouteBody(`<div class="empty-inline">${esc(err.message)} Directions start from where you are, so turn on location access for NUS Companion.</div><button class="btn secondary full" id="routeBack">Back</button>`);
      $("#routeBack",el).onclick=back;
      return;
    }
    if(selected!==dest) return;
    setRouteBody(`<div class="empty-inline"><span class="spinner sm"></span>Finding routes…</div>`);

    const straight=distanceM(from,dest);
    const transit={shuttle:null,public:null};   // null = still loading
    const street={};
    const settle=(m,v)=>{ street[m]=v; };
    const jobs={
      shuttle:planShuttleTrips(from,dest).catch(()=>[]).then(v=>{ transit.shuttle=v; onTransit(); }),
      public:loadTransitRoutes(from,dest).catch(()=>[]).then(v=>{ transit.public=v; onTransit(); })
    };
    for(const m of ["walk","cycle","drive"]){
      street[m]=loadStreetRoute(m,from,dest).then(r=>{ settle(m,r); setTab(m,`${walkMinutes(r.duration)} min`); if(current===m) pick(m); return r; })
        .catch(()=>{ settle(m,false); setTab(m,"–"); if(current===m) pick(m); return false; });
    }

    function setTab(m,text){ const t=$(`#modeTabs [data-mode="${m}"] small`,el); if(t) t.textContent=text; }
    // Route order: Arrive earliest, Shortest trip, Least walking or Fewest
    // transfers; the choice is remembered.
    const SORTS={arrive:"Arrive earliest",duration:"Shortest trip",walk:"Least walking",transfers:"Fewest transfers"};
    let sortBy=(()=>{ try{ const v=localStorage.getItem("nus_route_sort"); return SORTS[v]?v:"arrive"; }catch{ return "arrive"; } })();
    const ridesOf=it=>it.legs.filter(l=>l.mode!=="WALK").length;
    const SORT_FNS={
      arrive:(a,b)=>a.end-b.end,
      walk:(a,b)=>a.walk-b.walk||a.end-b.end,
      transfers:(a,b)=>ridesOf(a)-ridesOf(b)||a.end-b.end,
      duration:(a,b)=>a.duration-b.duration||a.end-b.end
    };
    function transitTrips(){ return [...(transit.shuttle||[]),...(transit.public||[])].sort(SORT_FNS[sortBy]); }
    function onTransit(){
      const trips=transitTrips(), done=transit.shuttle!=null&&transit.public!=null;
      setTab("transit",trips.length?`${walkMinutes(Math.min(...trips.map(t=>t.duration)))} min`:done?"–":"…");
      // Keep the list where it is while more routes arrive.
      if(current==="transit" && view==="list") renderTransitList();
    }

    let current=null, view="list", listScroll=0;
    function pick(mode){
      if(current&&current!==mode) slideNext="fade";
      current=mode; view="list";
      $$("#modeTabs button",el).forEach(b=>b.classList.toggle("on",b.dataset.mode===mode));
      if(mode==="transit") return renderTransitList();
      const r=street[mode];
      if(r instanceof Promise||r==null){
        setRouteBody(`<div class="empty-inline"><span class="spinner sm"></span>Finding ${MODE_LABELS[mode].toLowerCase()} route…</div>`);
        return;
      }
      if(r) renderStreet(mode,r);
      else{ setRouteBody(`<div class="empty-inline">No ${MODE_LABELS[mode].toLowerCase()} route found.</div>${footer()}`); bindFooter(); clearRoute(); }
    }

    function footer(trip=false){
      return `${trip&&TripActivity?`<button class="btn ${tripActive?"danger-soft":"primary"} full" id="tripBtn">${tripActive?"End trip":"Start trip"}</button><p class="small-help trip-help">${trip==="transit"?"Follows you in the Dynamic Island and on the lock screen, and buzzes one stop before you get off.":"Shows distance and time left in the Dynamic Island and on the lock screen."}</p>`:""}
        <div class="two route-actions"><button class="btn secondary" id="routeRecenter">Show my location</button><button class="btn danger-soft" id="routeEnd">Close</button></div>`;
    }
    function bindFooter(makePlan=null,makeSaved=null){
      const tripBtn=$("#tripBtn",el);
      if(tripBtn && makePlan) tripBtn.onclick=async()=>{
        try{
          if(tripActive){
            await TripActivity.end();
            tripActive=false; clearActiveTrip(); tripBtn.textContent="Start trip"; tripBtn.classList.replace("danger-soft","primary");
            return;
          }
          await TripActivity.start({trip:JSON.stringify(makePlan())});
          if(makeSaved) saveActiveTrip(makeSaved());
          tripActive=true; tripBtn.textContent="End trip"; tripBtn.classList.replace("primary","danger-soft");
          toast("Trip started. Check the Dynamic Island.");
          setCollapsed(true);
        }catch(err){ toast(err.message||"Couldn't start the trip."); }
      };
      $("#routeEnd",el).onclick=back;
      $("#routeRecenter",el).onclick=()=>{ if(lastPosition) map.setView([lastPosition.lat,lastPosition.lng],18,{animate:true}); };
    }

    function renderStreet(mode,route){
      const arrive=clockTime(new Date(Date.now()+route.duration*1000));
      peek(`${MODE_LABELS[mode]} · ${walkMinutes(route.duration)} min · ${distanceLabel(route.distance)} · arrive ${arrive}`);
      setRouteBody(`
        <div class="route-summary"><b>${walkMinutes(route.duration)} min</b><span>${distanceLabel(route.distance)} · arrive ${arrive}</span></div>
        <details class="route-steps"><summary>Step-by-step (${route.steps.length})</summary>
          <ol>${route.steps.map(st=>`<li>${stepIcon(st)}<span>${esc(st.text)}${st.type!=="arrive"?`<small>${distanceLabel(st.distance)}</small>`:""}</span></li>`).join("")}</ol>
        </details>${footer("street")}`);
      bindFooter(()=>streetPlan(mode,route),()=>({kind:"street",mode,dest:{type:dest.type,code:dest.code,name:dest.name,lat:dest.lat,lng:dest.lng,...(dest.type==="public"||dest.type==="nus"?{}:{})}}));
      const color={walk:"#6d5df5",cycle:"#0ea5e9",drive:"#f97316"}[mode];
      drawPath([
        L.polyline(route.path,{color:"#ffffff",weight:9,opacity:.9}),
        L.polyline(route.path,{color,weight:5,opacity:1,dashArray:mode==="walk"?"1 9":null,lineCap:"round"}),
        L.polyline([[from.lat,from.lng],route.path[0]],{color,weight:3,dashArray:"4 6"})
      ]);
    }

    function legChips(it){
      return it.legs.filter(l=>l.mode!=="WALK"||l.distance>150).map(l=>l.mode==="WALK"
        ?`<span class="leg-chip walk">${icon(MODE_ICONS.walk,13)}${walkMinutes(l.duration)}</span>`
        :`<span class="leg-chip" style="--c:${lineColor(l)}">${icon(legIcon(l),13)}${esc(l.line)}</span>`).join(`<span class="leg-sep">›</span>`);
    }

    function liveText(it){
      const l=it.live, m=l.next;
      return `${l.service} ${m<=0?"arriving now":`in ${m} min`} at ${NUS_STOPS.find(s=>s.code===l.stop)?.name||l.stop}`;
    }

    function renderTransitList(){
      const its=transitTrips(), loading=transit.shuttle==null||transit.public==null;
      if(!its.length && !loading){
        peek("No public transport found");
        setRouteBody(`<div class="empty-inline">No shuttle, bus or MRT routes found right now. Try Walk or Drive.</div>${footer()}`);
        bindFooter(); clearRoute(); return;
      }
      if(its[0]) peek(`Transit · ${walkMinutes(its[0].duration)} min · arrive ${clockTime(its[0].end)}`);
      setRouteBody(`<div class="route-sort">${Object.entries(SORTS).map(([k,l])=>`<button class="chip ${sortBy===k?"on":""}" data-sort="${k}">${l}</button>`).join("")}</div>
        ${its.length?`<p class="route-count">${its.length} route${its.length===1?"":"s"}</p>`:""}
        ${its.map((it,i)=>`
        <button class="route-card" data-i="${i}">
          <div class="route-card-top"><b>${walkMinutes(it.duration)} min</b>${it.shuttle?`<span class="pill live">Live</span>`:`<span>${clockTime(it.start)} – ${clockTime(it.end)}</span>`}</div>
          <div class="route-legs">${legChips(it)}</div>
          <small>${it.shuttle?`NUS shuttle · ${esc(liveText(it))}`:`${ridesOf(it)>1?`${ridesOf(it)-1} transfer${ridesOf(it)===2?"":"s"} · `:"No transfers · "}${distanceLabel(it.walk)} walking${it.source?` · ${esc(it.source)}`:""}`}</small>
        </button>`).join("")}
        ${loading?`<div class="empty-inline"><span class="spinner sm"></span>${its.length?"Looking for more routes…":"Finding shuttle, bus and MRT routes…"}</div>`:""}
        <p class="small-help">NUS shuttle times are live. Bus and MRT routes are from ${its.some(t=>t.source==="OneMap")?"OneMap (LTA) and Transitous":`LTA timetables via Transitous${oneMapStatus&&oneMapStatus!=="ok"?` (${esc(oneMapStatus)})`:""}`}; the first bus in a route shows its live arrival. Prefer a different route? Open it and tap Save as commute.</p>
        ${footer()}`);
      bindFooter();
      $$(".route-card[data-i]",el).forEach(b=>b.onclick=()=>{ listScroll=$("#mapPanel",el).scrollTop; slideNext="forward"; renderTransitDetail(its[+b.dataset.i]); });
      $$("[data-sort]",el).forEach(b=>b.onclick=()=>{ sortBy=b.dataset.sort; try{ localStorage.setItem("nus_route_sort",sortBy); }catch{} renderTransitList(); });
      if(its[0]) drawTransit(its[0]);
    }

    let drawn=null;
    function drawTransit(it,{refit=true}={}){
      drawn=it;
      const layers=[];
      for(const l of it.legs){
        if(!l.path.length) continue;
        if(l.mode==="WALK") layers.push(L.polyline(l.path,{color:"#6d5df5",weight:4,dashArray:"1 8",lineCap:"round"}));
        else{
          layers.push(L.polyline(l.path,{color:"#ffffff",weight:9,opacity:.9}));
          layers.push(L.polyline(l.path,{color:lineColor(l),weight:6}));
          layers.push(L.circleMarker([l.from.lat,l.from.lng],{radius:6,color:"#fff",weight:2,fillColor:lineColor(l),fillOpacity:1}));
          layers.push(L.circleMarker([l.to.lat,l.to.lng],{radius:6,color:"#fff",weight:2,fillColor:lineColor(l),fillOpacity:1}));
        }
      }
      drawPath(layers,refit);
      // Shuttle trips start as straight lines between stops; swap in road paths.
      const pending=it.legs.filter(l=>l.needsPath);
      if(pending.length) Promise.all(pending.map(loadLegPath)).then(()=>{ if(drawn===it && selected===dest) drawTransit(it,{refit:false}); });
    }

    async function renderTransitDetail(it){
      view="detail";
      const first=it.legs.find(l=>l.mode==="BUS"||l.mode==="SHUTTLE");
      peek(`${first?transitLabel(first):"Transit"} · ${walkMinutes(it.duration)} min · arrive ${clockTime(it.end)}`);
      setRouteBody(`
        <button class="link" id="routeOptions">‹ All routes</button>
        <div class="route-summary"><b>${walkMinutes(it.duration)} min</b><span>arrive around ${clockTime(it.end)}</span></div>
        <ol class="itinerary">${it.legs.map((l,i)=>{
          if(l.mode==="WALK") return l.distance<20?"":`<li class="it-walk"><span class="it-dot walk">${icon(MODE_ICONS.walk,14)}</span><div><b>Walk ${distanceLabel(l.distance)}</b><small>to ${esc(l.to.name)} · ${walkMinutes(l.duration)} min</small></div></li>`;
          return `<li style="--c:${lineColor(l)}"><span class="it-dot">${icon(legIcon(l),14)}</span><div>
            <b>${esc(transitLabel(l))}</b>${l.headsign?`<small>towards ${esc(l.headsign)}</small>`:""}
            <small>Board at <b>${esc(l.from.name)}</b>${l.from.code&&l.mode==="BUS"?` (${esc(l.from.code)})`:""}${l.mode==="SHUTTLE"?"":` · ${clockTime(l.start)}`}</small>
            ${l===first?`<div class="live-next" id="liveNext"><span class="spinner sm"></span>Checking live arrival…</div>`:""}
            ${l.from.code?widgetButtonHTML(`data-pin-leg="${i}"`,l.from.code):""}
            <small>${l.stops} stop${l.stops===1?"":"s"}${l.via?.length?` (via ${esc(l.via.join(", "))})`:""} · get off at <b>${esc(l.to.name)}</b></small>
          </div></li>`;
        }).join("")}
        <li class="it-end"><span class="it-dot end">${icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",14)}</span><div><b>Arrive at ${esc(title)}</b><small>around ${clockTime(it.end)}</small></div></li>
        </ol>
        <button class="btn secondary full save-commute" id="saveCommute">${icon(PLACE_ICONS.star.path,16)}Save as commute</button>
        ${footer("transit")}`);
      bindFooter(()=>transitPlan(it),()=>({kind:"transit",name:title,commute:commuteFromItinerary(it,{name:`To ${title}`,to:{name:title,lat:dest.lat,lng:dest.lng}})}));
      $("#saveCommute",el).onclick=()=>saveCommute(it,{name:title,lat:dest.lat,lng:dest.lng});
      $$("[data-pin-leg]",el).forEach(b=>b.onclick=()=>{
        const l=it.legs[+b.dataset.pinLeg];
        pinWidgetStop({code:l.from.code,name:l.from.name,lat:l.from.lat,lng:l.from.lng,nus:l.mode==="SHUTTLE"},b,{service:l.line,to:l.to.name});
      });
      $("#routeOptions",el).onclick=()=>{
        view="list"; slideNext="back"; renderTransitList();
        $("#mapPanel",el).scrollTop=listScroll; // back where you were in the list
      };
      drawTransit(it);
      const showLive=async()=>{
        if(!first?.from.code) return;
        try{
          const rows=first.mode==="SHUTTLE"?await loadShuttleArrivals(first.from.code):await loadPublicArrivals(first.from.code);
          const live=rows.find(x=>String(x.service)===String(first.line));
          const box=$("#liveNext",el); if(!box) return;
          box.innerHTML=live&&live.next!=null?`<span class="pill live">Live</span> Next ${esc(first.line)} ${live.next<=0?"arriving now":`in ${live.next} min`}${live.times.length>1?`, then ${live.times.slice(1).join(", ")} min`:""}`
            :`No live data for ${esc(first.line)} right now.`;
        }catch{ const box=$("#liveNext",el); if(box) box.textContent="Live arrival unavailable."; }
      };
      showLive();
      clearInterval(refreshTimer);
      refreshTimer=setInterval(()=>{ if(view==="detail" && activeView==="map" && !document.hidden) showLive(); },30000);
    }

    // Trip plans for the native tracker (ios/App/App/Trip/TripTracker.swift).
    function transitPlan(it){
      return {destination:title, mode:"transit", end:+it.end, legs:it.legs.filter(l=>l.mode!=="WALK"||l.distance>=20).map(l=>({
        mode:l.mode, line:l.line||"", color:l.mode==="WALK"?"#8b7cff":lineColor(l),
        toName:l.to.name==="your destination"?title:l.to.name, toLat:l.to.lat, toLng:l.to.lng,
        code:(l.mode==="SHUTTLE"||l.mode==="BUS")&&l.from.code?l.from.code:null,
        liveKind:l.mode==="SHUTTLE"?"shuttle":l.mode==="BUS"?"bus":null,
        stops:(l.stopList||[]).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)).map(p=>({name:p.name,lat:p.lat,lng:p.lng,time:p.time})),
        path:l.mode==="WALK"?l.path:[], duration:l.duration||0, start:+l.start, end:+l.end
      }))};
    }
    function streetPlan(mode,route){
      const now=Date.now();
      return {destination:title, mode, end:now+route.duration*1000, legs:[{
        mode:mode.toUpperCase(), line:"", color:{walk:"#6d5df5",cycle:"#0ea5e9",drive:"#f97316"}[mode],
        toName:title, toLat:dest.lat, toLng:dest.lng, code:null, liveKind:null, stops:[],
        path:route.path, duration:route.duration, start:now, end:now+route.duration*1000
      }]};
    }

    pick(startMode||(straight>1000||distanceM(from,dest)>600?"transit":"walk"));
  }

  /* ---------- Saved commutes (app/commutes.js) ---------- */

  function saveCommute(it,to){
    const suggested=(state.places||[]).find(p=>distanceM(p,to)<150)?.name||to.name;
    openModal(`<h2>Save as commute</h2>
      <p class="subtle">Keeps this exact route (${esc(it.legs.filter(isRide).map(l=>l.line||transitLabel(l)).join(" → "))}). Open it any time from the map or Today with live times.</p>
      <form class="form" id="commuteForm">
        <input class="input big" name="name" value="${esc(`To ${suggested}`)}" required>
        <button class="btn primary full">Save commute</button>
      </form>`);
    $("#commuteForm").onsubmit=e=>{
      e.preventDefault();
      const c=commuteFromItinerary(it,{name:String(new FormData(e.target).get("name")).trim(),to});
      state.commutes=[...(state.commutes||[]),c];
      save({immediate:true}); closeModal(); renderSaved();
      toast(`Saved “${c.name}”`);
    };
  }

  async function openCommute(c,{trip=false}={}){
    clearInterval(refreshTimer);
    clearRoute();
    if(pinMarker){ pinMarker.remove(); pinMarker=null; }
    selected=c;
    hideResults();
    const rides=c.legs.filter(isRide);
    openPanel(`<p class="kicker">${trip?"TRIP IN PROGRESS":"COMMUTE"}</p><h2>${esc(trip?`To ${c.to.name}`:c.name)}</h2>
      <div class="route-summary" id="commuteSummary"><span class="spinner sm"></span><span>Checking live times…</span></div>
      <ol class="itinerary">${c.legs.map((l,i)=>{
        if(!isRide(l)) return `<li class="it-walk"><span class="it-dot walk">${icon(MODE_ICONS.walk,14)}</span><div><b>Walk ${distanceLabel(l.distance)}</b><small>to ${esc(l.to.name)} · ${walkMinutes(l.duration)} min</small></div></li>`;
        return `<li style="--c:${lineColor(l)}"><span class="it-dot">${icon(legIcon(l),14)}</span><div>
          <b>${esc(transitLabel(l))}</b>${l.headsign?`<small>towards ${esc(l.headsign)}</small>`:""}
          <small>Board at <b>${esc(l.from.name)}</b>${l.from.code&&l.mode==="BUS"?` (${esc(l.from.code)})`:""}</small>
          ${l.mode==="BUS"||l.mode==="SHUTTLE"?`<div class="live-next" data-leg-live="${i}"><span class="spinner sm"></span>Live times…</div>`:""}
          ${l.from.code?widgetButtonHTML(`data-pin-leg="${i}"`,l.from.code):""}
          <small>${l.stops} stop${l.stops===1?"":"s"} · ${walkMinutes(l.duration)} min · get off at <b>${esc(l.to.name)}</b></small>
        </div></li>`;
      }).join("")}
        <li class="it-end"><span class="it-dot end">${icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",14)}</span><div><b>${esc(c.to.name)}</b></div></li>
      </ol>
      ${trip?`<button class="btn danger-soft full" id="tripEnd">End trip</button>`
        :`<div class="two route-actions"><button class="btn secondary" id="commuteFresh">Plan fresh routes</button><button class="btn danger-soft" id="commuteDelete">Delete</button></div>`}`,{directions:true});
    $("#tripEnd",el)?.addEventListener("click",async()=>{
      try{ await TripActivity?.end(); }catch{}
      tripActive=false; clearActiveTrip(); closePanel(); toast("Trip ended");
    });
    $$("[data-pin-leg]",el).forEach(b=>b.onclick=()=>{
      const l=c.legs[+b.dataset.pinLeg];
      pinWidgetStop({code:l.from.code,name:l.from.name,lat:l.from.lat,lng:l.from.lng,nus:l.mode==="SHUTTLE"},b,{service:l.line,to:l.to.name});
    });
    if(!trip) $("#commuteFresh",el).onclick=()=>showRoute({type:"place",code:c.to.name,name:"",lat:c.to.lat,lng:c.to.lng});
    if(!trip) $("#commuteDelete",el).onclick=async()=>{
      if(!await confirmSheet(`Delete “${c.name}”?`,{confirm:"Delete"})) return;
      state.commutes=state.commutes.filter(x=>x.id!==c.id); save({immediate:true}); closePanel(); renderSaved();
    };
    // Draw the saved route.
    const layers=[];
    for(const l of c.legs){
      if(!l.path?.length) continue;
      if(!isRide(l)) layers.push(L.polyline(l.path,{color:"#6d5df5",weight:4,dashArray:"1 8",lineCap:"round"}));
      else layers.push(L.polyline(l.path,{color:"#ffffff",weight:9,opacity:.9}),L.polyline(l.path,{color:lineColor(l),weight:6}),
        L.circleMarker([l.from.lat,l.from.lng],{radius:6,color:"#fff",weight:2,fillColor:lineColor(l),fillOpacity:1}));
    }
    if(layers.length) drawPath(layers);
    const load=async()=>{
      let pos=null;
      try{ pos=await getPosition(); }catch{}
      const live=await commuteLive(c,pos).catch(()=>null);
      if(selected!==c) return;
      const sum=$("#commuteSummary",el);
      if(sum&&live) sum.innerHTML=`<b>${live.first&&live.catchable?.length?`${live.leaveIn<=0?"Leave now":`Leave in ${live.leaveIn} min`}`:"Live"}</b><span>${esc(commuteSummaryHTML(live))}</span>`;
      for(const [i,l] of c.legs.entries()){
        const box=$(`[data-leg-live="${i}"]`,el); if(!box) continue;
        try{
          const t=await legLiveTimes(l);
          box.innerHTML=t?.length?`<span class="pill live">Live</span> ${esc(l.line)} in ${t.map(m=>m<=0?"Arr":m).join(", ")} min`:`No ${esc(l.line)} right now`;
        }catch{ box.textContent="Live times unavailable"; }
      }
    };
    load();
    refreshTimer=setInterval(()=>{ if(selected===c && activeView==="map" && !document.hidden) load(); },30000);
  }

  async function selectStop(stop){
    clearInterval(refreshTimer);
    clearRoute();
    if(selected?.type==="nus") nusMarkers.get(selected.code)?.setIcon(nusIcon());
    if(pinMarker){ pinMarker.remove(); pinMarker=null; }
    selected=stop;
    hideResults();
    if(stop.type==="nus"){
      nusMarkers.get(stop.code)?.setIcon(nusIcon(true));
      localStorage.setItem("nus_fav_stop",stop.code);
    }else{
      pinMarker=L.marker([stop.lat,stop.lng],{icon:pinIcon(),zIndexOffset:1000}).addTo(map);
    }
    // A shuttle stop next to a public stop (or vice versa) shows both boards.
    // The public stop catalogue can take a moment, so it fills in afterwards.
    let twin=stop.type==="nus" ? null : NUS_STOPS.find(n=>distanceM(n,stop)<45);

    openPanel(`<p class="kicker">${stop.type==="nus"?"NUS SHUTTLE STOP":`BUS STOP ${esc(stop.code)}`}</p>
      <div class="panel-title"><h2>${esc(stop.name)}</h2><button class="icon-btn sm" id="refreshEta" aria-label="Refresh">${icon("M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",18)}</button></div>
      <p class="subtle">${[stop.type==="public"&&stop.road?esc(stop.road):"",distanceText(stop).replace(/^ · /,"")].filter(Boolean).join(" · ")}</p>
      ${walkButton()}
      ${widgetButtonHTML(`id="pinWidget"`,stop.code)}
      <div id="etaMain"><div class="empty-inline"><span class="spinner sm"></span>Loading live times…</div></div>
      <div id="twinBox"></div>
      <p class="updated" id="etaUpdated"></p>`);
    $("#walkHere",el).onclick=()=>showRoute(stop);
    $("#pinWidget",el)?.addEventListener("click",e=>pinWidgetStop({code:stop.code,name:stop.name,lat:stop.lat,lng:stop.lng,nus:stop.type==="nus"},e.currentTarget));

    focusOn(stop,Math.max(map.getZoom(),17));
    const twinHead=()=>twin?`<h4 class="sub-head">${twin.type==="nus"?"NUS shuttles here":"Public buses here"}<small>${esc(twin.type==="nus"?twin.name:`${twin.name} · ${twin.code}`)}</small></h4>`:"";
    const load=async()=>{
      const [main,other]=await Promise.all([arrivalsHTML(stop),twin?arrivalsHTML(twin):""]);
      if(selected!==stop) return;
      $("#etaMain",el).innerHTML=main;
      $("#twinBox",el).innerHTML=twin?twinHead()+other:"";
      $("#etaUpdated",el).textContent=`Updated ${new Date().toLocaleTimeString("en-SG",{hour:"numeric",minute:"2-digit"})} · refreshes automatically`;
    };
    $("#refreshEta",el).onclick=load;
    load();
    if(stop.type==="nus") publicStopNear(stop).then(t=>{ if(t && selected===stop){ twin=t; load(); } });
    refreshTimer=setInterval(()=>{ if(activeView==="map"&&!document.hidden) load(); },30000);
  }

  async function selectPlace(p){
    clearInterval(refreshTimer);
    clearRoute();
    if(selected?.type==="nus") nusMarkers.get(selected.code)?.setIcon(nusIcon());
    if(pinMarker) pinMarker.remove();
    selected=p;
    hideResults();
    if(p.type!=="saved") pinMarker=L.marker([p.lat,p.lng],{icon:pinIcon(),zIndexOffset:1000}).addTo(map);
    else pinMarker=null;
    const near=nearestNusStops(p,1)[0];
    const showShuttle=near && near.distance<800;
    openPanel(`<p class="kicker">${esc(placeKindLabel(p).toUpperCase())}${p.floor!=null?` · LEVEL ${esc(String(p.floor))}`:""}</p>
      <h2>${esc(p.code)}</h2>
      <p class="subtle place-address">${esc(p.name&&p.name!==p.code?p.name:"")}</p>
      <p class="subtle">${[p.kind,distanceText(p).replace(/^ · /,"")].filter(Boolean).join(" · ")}</p>
      ${p.phone||p.url?`<div class="place-links">${p.phone?`<a class="chip" href="tel:${esc(p.phone.replace(/[^+\d]/g,""))}">${icon("M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",14)}Call</a>`:""}${p.url?`<a class="chip" href="${esc(p.url)}" target="_blank" rel="noopener">${icon("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",14)}Website</a>`:""}</div>`:""}
      <div class="place-actions">${walkButton()}<button class="btn secondary" id="savePlace">${icon(p.type==="saved"?"M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z":PLACE_ICONS.star.path,18)}${p.type==="saved"?"Edit":"Save"}</button></div>
      ${showShuttle?`<h4 class="sub-head">Nearest shuttle stop<button class="link" id="openNear">${esc(near.name)} · ${distanceLabel(near.distance)}</button></h4>
        <div id="etaNear"><div class="empty-inline"><span class="spinner sm"></span>Loading live times…</div></div>`:""}`);
    $("#walkHere",el).onclick=()=>showRoute(p);
    $("#savePlace",el).onclick=()=>openSaveSheet(p);
    focusOn(p,18);
    if(showShuttle){
      $("#openNear",el).onclick=()=>selectStop(near);
      const load=async()=>{ const h=await arrivalsHTML(near,{embed:false}); if(selected===p) $("#etaNear",el).innerHTML=h; };
      load();
      refreshTimer=setInterval(()=>{ if(activeView==="map"&&!document.hidden) load(); },30000);
    }
  }

  async function showNearby(){
    hideResults();
    openPanel(`<p class="kicker">NEARBY</p><h2>Shuttle stops near you</h2><div id="nearList"><div class="empty-inline"><span class="spinner sm"></span>Finding your location…</div></div>`);
    try{
      const pos=await getPosition({fresh:true});
      startLocation();
      map.setView([pos.lat,pos.lng],17,{animate:true});
      const stops=nearestNusStops(pos,5);
      $("#nearList",el).innerHTML=`<div class="list">${stops.map(s=>`
        <button class="list-row tap" data-code="${esc(s.code)}"><span class="stop-dot"></span><div><b>${esc(s.name)}</b><small>${distanceLabel(s.distance)} away</small></div>${icon("M9 18l6-6-6-6",18)}</button>`).join("")}</div>`;
      $$("[data-code]",el).forEach(b=>b.onclick=()=>selectStop(NUS_STOPS.find(s=>s.code===b.dataset.code)));
    }catch(err){
      $("#nearList",el).innerHTML=`<div class="empty-inline">${esc(err.message)} Turn on location access for NUS Companion to see stops near you.</div>`;
    }
  }

  /* ---------- Search ---------- */
  // Typing shows NUS venues, stops and saved places instantly, then places
  // around the visible map (nearest first). Enter shows every result as a
  // pin; moving the map offers "Search this area".

  function hideResults(){ const r=$("#mapResults",el); if(r){ r.hidden=true; r.innerHTML=""; } }

  function resultIcon(p){
    if(p.type==="saved") return icon((PLACE_ICONS[p.icon]||PLACE_ICONS.star).path,16);
    if(p.type==="nus"||p.type==="public") return icon("M8 6v6M16 6v6M2 12h20M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z",16);
    return icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",16);
  }

  function resultSub(p){
    if(p.type==="public") return `Bus stop ${p.code}${p.road?` · ${p.road}`:""}`;
    if(p.type==="place") return [p.kind,p.name].filter(Boolean).join(" · ");
    return p.name!==p.code?`${placeKindLabel(p)} · ${p.name}`:placeKindLabel(p);
  }

  function showResults(local,nearby,{query="",loading=false}={}){
    const r=$("#mapResults",el);
    const rows=[...local,...nearby];
    r.hidden=false;
    const row=(p,i)=>`
      <button class="result-row" data-i="${i}">
        <span class="result-icon t-${p.type}">${resultIcon(p)}</span>
        <span class="result-text"><b>${esc(p.type==="public"?p.name:p.code)}</b><small>${esc(resultSub(p))}</small></span>
        ${p.distance!=null?`<span class="result-dist">${distanceLabel(p.distance)}</span>`:""}
      </button>`;
    r.innerHTML=local.map((p,i)=>row(p,i)).join("")
      +(nearby.length?`<div class="result-head">Near this area</div>${nearby.map((p,i)=>row(p,local.length+i)).join("")}`:"")
      +(loading?`<div class="result-status"><span class="spinner sm"></span>Searching nearby…</div>`:"")
      +(!loading&&nearby.length>1?`<button class="result-row more" id="showAllPins"><span class="result-icon">${icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",16)}</span><span class="result-text"><b>Show all ${nearby.length} on map</b></span></button>`:"")
      +(!loading&&!rows.length&&query?`<div class="result-status">No results for “${esc(query)}”.</div>`:"");
    $$(".result-row[data-i]",r).forEach(b=>b.onclick=()=>choose(rows[+b.dataset.i]));
    $("#showAllPins",r)?.addEventListener("click",()=>showPins(nearby,query));
  }

  function viewBounds(){
    const b=map.getBounds();
    return {n:b.getNorth(),s:b.getSouth(),e:b.getEast(),w:b.getWest()};
  }

  async function runSearch(q,{pins=false}={}){
    const input=$("#mapSearch",el);
    const local=await searchPlacesLocal(q,{limit:pins?4:6});
    if(input.value.trim()!==q) return;
    const minLen=applePlaceSearch?2:3;
    showResults(local,[],{query:q,loading:q.length>=minLen});
    if(q.length<minLen) return;
    const c=map.getCenter();
    const nearby=await searchPlacesInArea(q,viewBounds(),{lat:c.lat,lng:c.lng},{
      onPartial:rows=>{ if(input.value.trim()===q) showResults(local,rows.slice(0,15),{query:q,loading:true}); }});
    if(input.value.trim()!==q) return;
    showResults(local,nearby.slice(0,15),{query:q});
    if(pins && nearby.length) showPins(nearby,q);
  }

  // Drop a pin for every result and fit them on screen.
  function showPins(rows,query){
    clearPins();
    hideResults();
    $("#mapSearch",el).blur();
    resultsLayer=L.layerGroup(rows.map(p=>L.marker([p.lat,p.lng],{icon:L.divIcon({className:"",html:`<div class="mk-result">${icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",13)}</div>`,iconSize:[26,26],iconAnchor:[13,13]}),title:p.code,zIndexOffset:900})
      .on("click",()=>selectPlace(p)))).addTo(map);
    const near=rows.slice(0,10).map(p=>[p.lat,p.lng]);
    lastSearch=null;
    map.fitBounds(L.latLngBounds(near),{padding:[50,50],paddingTopLeft:[40,170],maxZoom:17});
    // Remember where the results were shown only once the map has settled,
    // so fitting them doesn't itself offer "Search this area".
    const settle=()=>{ if(!lastSearch) lastSearch={query,center:map.getCenter()}; };
    map.once("moveend",settle);
    setTimeout(settle,1200); // in case the map didn't need to move
    $("#searchArea",el).hidden=true;
  }

  function clearPins(){
    if(resultsLayer){ resultsLayer.remove(); resultsLayer=null; }
    lastSearch=null;
    const b=$("#searchArea",el); if(b) b.hidden=true;
  }

  async function choose(p){
    $("#mapSearch",el).blur();
    hideResults();
    if(p.type==="nus"||p.type==="public") return selectStop(p);
    if(p.lat==null){
      const loc=await resolveVenue(p.code);
      if(!loc){ toast(`Couldn't find ${p.code} on the map`); return; }
      p={...p,lat:loc.lat,lng:loc.lng};
    }
    selectPlace(p);
  }

  /* ---------- Deep links ---------- */

  async function applyParams(params){
    if(params.trip){
      openActiveTrip();
    }else if(params.commute){
      const c=(state.commutes||[]).find(x=>x.id===params.commute);
      if(c) openCommute(c); else toast("That commute was deleted.");
    }else if(params.stop){
      const code=String(params.stop);
      const stop=NUS_STOPS.find(s=>s.code===code) || (await loadPublicStops()).find(s=>s.code===code);
      if(stop) selectStop(stop);
    }else if(params.venue){
      const p=await resolveVenue(params.venue);
      if(p){
        if(p.type==="nus") selectStop(p);
        else selectPlace({...p,code:params.venue});
      }else toast(`Couldn't find ${params.venue} on the map`);
    }else if(params.nearby){
      showNearby();
    }
  }

  function render(){
    el.innerHTML=`
      <div id="mapCanvas"></div>
      <div class="map-top">
        <div class="map-search">
          ${icon("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",18)}
          <input id="mapSearch" type="search" placeholder="Search venues, bus stops, places" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
          <button class="clear-btn" id="mapClear" hidden aria-label="Clear">${icon("M6 6l12 12M18 6 6 18",16)}</button>
        </div>
        <div id="mapResults" class="map-results" hidden></div>
        <button class="trip-bar" id="tripBar" hidden>${icon("M3 11l19-9-9 19-2-8-8-2z",16)}<span></span>${icon("M9 18l6-6-6-6",16)}</button>
        <button class="chip solid search-area" id="searchArea" hidden>${icon("M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",14)}Search this area</button>
        <div class="map-chips">
          <span id="savedChips" class="saved-chips"></span>
          <button class="chip solid" id="chipNearby">${icon("M8 6v6M16 6v6M2 12h20M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z",14)}Shuttles near me</button>
          ${["UTOWN","CLB","KR-MRT","COM3"].map(c=>`<button class="chip solid" data-stop="${c}">${esc(NUS_STOPS.find(s=>s.code===c).name)}</button>`).join("")}
        </div>
      </div>
      <button class="map-fab layers" id="layersBtn" aria-label="Map layers">${icon("M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",22)}</button>
      <div class="layers-menu" id="layersMenu" hidden></div>
      <button class="map-fab" id="locateMe" aria-label="My location">${icon("M12 2v3M12 19v3M2 12h3M19 12h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",22)}</button>
      <div class="map-panel" id="mapPanel" hidden></div>`;

    const input=$("#mapSearch",el);
    input.addEventListener("input",()=>{
      const q=input.value.trim();
      $("#mapClear",el).hidden=!q;
      clearTimeout(searchTimer);
      if(!q){ hideResults(); return; }
      // A new search replaces the open place card, as in Google Maps.
      if(!$("#mapPanel",el).hidden && !el.classList.contains("routing")) closePanel();
      // Local results right away; the area search waits for a pause in typing.
      searchPlacesLocal(q,{limit:6}).then(rows=>{ if(input.value.trim()===q) showResults(rows,[],{query:q,loading:q.length>=(applePlaceSearch?2:3)}); });
      // Apple Maps search is quick; OpenStreetMap allows one request a second.
      searchTimer=setTimeout(()=>runSearch(q),applePlaceSearch?300:650);
    });
    input.addEventListener("keydown",e=>{
      if(e.key!=="Enter") return;
      e.preventDefault();
      const q=input.value.trim();
      if(!q) return;
      clearTimeout(searchTimer);
      runSearch(q,{pins:true});
    });
    input.addEventListener("focus",()=>{ if(input.value.trim()) runSearch(input.value.trim()); });
    $("#mapClear",el).onclick=()=>{ input.value=""; $("#mapClear",el).hidden=true; hideResults(); clearPins(); input.focus(); };
    $("#searchArea",el).onclick=()=>{ if(lastSearch){ $("#mapSearch",el).value=lastSearch.query; runSearch(lastSearch.query,{pins:true}); } };
    $("#chipNearby",el).onclick=showNearby;
    $("#tripBar",el).onclick=openActiveTrip;
    renderTripBar();
    $("#layersBtn",el).onclick=toggleLayersMenu;
    enablePanelDrag();
    $$("[data-stop]",el).forEach(b=>b.onclick=()=>selectStop(NUS_STOPS.find(s=>s.code===b.dataset.stop)));
    $("#locateMe",el).onclick=async()=>{
      try{
        const pos=await getPosition({fresh:true});
        startLocation();
        map.setView([pos.lat,pos.lng],17,{animate:true});
      }catch(err){ toast(err.message); }
    };
  }

  return {
    title:"Map",
    keepScroll:true,
    refresh(){ renderSaved(); },
    mount(c){
      el=c;
      render();
      if(window.L) initMap();
      else toast("The map couldn't load. Check your connection.");
    },
    show(params){
      if(!ready) return;
      applyBaseStyle(); // the app theme may have changed
      // Leaflet measures its container; it was hidden until now.
      setTimeout(()=>map.invalidateSize(),0);
      startLocation();
      renderSaved();
      if(Object.keys(params).length){
        pendingParams=params;
        setTimeout(()=>{ if(pendingParams===params) applyParams(params); },50);
      }
    }
  };
})();
