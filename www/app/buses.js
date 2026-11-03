/* Buses tab: live arrivals like SingaBus. A map of bus stops on top and a
 * sheet of stops below: starred stops first, then the stops in the area the
 * map shows (near you to begin with), each with every service's next three
 * buses, deck type and how full they are. Tap a stop (pin or card) for its
 * board; tap a service for its route on the map and where its next buses
 * are right now (LTA's live bus positions). Search any stop by name, number
 * or road. Times refresh every 20 seconds while the tab is shown.
 *   state.busFavs: [{type:"nus"|"public", code, name, lat, lng, road}]
 */

views.buses=(()=>{
  let el=null, timer=null, map=null, base=null, baseStyle="", pins=null, routeLayer=null, meMarker=null;
  let pos=null, area=null, searched=null, selected=null, service=null, sheetH=null;
  const open=new Set();      // keys of boards that are expanded
  const loaded=new Map();    // key -> last board HTML, so re-renders don't flash
  const boards=new Map();    // key -> last arrival rows (for live bus positions)
  const keyOf=s=>`${s.type}:${s.code}`;
  const isFav=s=>(state.busFavs||[]).some(f=>keyOf(f)===keyOf(s));
  const wide=()=>matchMedia("(min-width:900px)").matches;
  const BUS_ICON="M8 6v6M16 6v6M2 12h20M7 18h.01M17 18h.01M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z";

  /* ---------- Map ---------- */

  function initMap(){
    if(map) return;
    map=L.map($("#busMap",el),{zoomControl:false,attributionControl:true,maxZoom:19}).setView([NUS_CENTER.lat,NUS_CENTER.lng],16);
    pins=L.layerGroup().addTo(map);
    applyBase();
    // The list follows the map: moving it shows the stops in that area.
    // Only moves you make count (dragging, pinching, scrolling), not the app flying to a stop.
    let t=null;
    map.on("moveend",()=>{ clearTimeout(t); t=setTimeout(()=>{ if(map._userMoved&&!service){ map._userMoved=false; listArea(map.getCenter()); } },250); });
    map.on("dragstart",()=>{ map._userMoved=true; });
    map.getContainer().addEventListener("wheel",()=>{ map._userMoved=true; },{passive:true});
    map.getContainer().addEventListener("touchstart",e=>{ if(e.touches.length>1) map._userMoved=true; },{passive:true});
  }

  // Same base map as the Map tab (OpenFreeMap; the plain tiles if that can't load).
  function applyBase(){
    const pref=(()=>{ try{ return localStorage.getItem("nus_map_style")||"auto"; }catch{ return "auto"; } })();
    let style=pref==="auto"?(document.body.classList.contains("light")?"liberty":"dark"):pref;
    if(style!=="classic"&&!L.maplibreGL){ loadMapLibre().then(applyBase).catch(()=>{ style="classic"; setBase("classic"); }); return; }
    setBase(style);
  }
  function setBase(style){
    if(style===baseStyle||!map) return;
    if(base) map.removeLayer(base);
    baseStyle=style;
    if(style==="classic") base=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
    else{
      base=L.maplibreGL({style:"https://tiles.openfreemap.org/styles/liberty",attribution:'<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
      base.getContainer?.()?.classList.toggle("map-dark",style==="dark");
      const gl=base.getMaplibreMap();
      gl.on("style.load",()=>{ for(const l of gl.getStyle().layers.filter(l=>l.id.startsWith("poi"))){ const f=gl.getFilter(l.id); gl.setFilter(l.id,f?["all",f,["!=",["get","class"],"bus"]]:["!=",["get","class"],"bus"]); } });
    }
    base.bringToBack?.();
  }

  const pinIcon=(s,{on=false,fav=false}={})=>L.divIcon({className:"",iconSize:on?[34,34]:[26,26],iconAnchor:on?[17,17]:[13,13],
    html:`<div class="bus-pin ${s.type} ${on?"on":""} ${fav?"fav":""}">${icon(BUS_ICON,on?16:12)}</div>`});

  // Pins for the stops in the list (and the selected one), the selected stop bigger.
  function drawPins(){
    if(!map) return;
    pins.clearLayers();
    if(service) return;   // a service on the map shows its own stops
    const seen=new Set();
    for(const s of [...(area?.stops||[]),...(state.busFavs||[]),...(searched?[searched]:[])]){
      const k=keyOf(s); if(seen.has(k)) continue; seen.add(k);
      const on=selected&&keyOf(selected)===k;
      L.marker([s.lat,s.lng],{icon:pinIcon(s,{on,fav:isFav(s)}),zIndexOffset:on?900:0,title:s.name})
        .on("click",()=>selectStop(s,{fromMap:true})).addTo(pins);
    }
  }

  function showMe(){
    if(!map||!pos) return;
    if(!meMarker) meMarker=L.marker([pos.lat,pos.lng],{icon:L.divIcon({className:"",html:`<div class="mk-me"><span></span></div>`,iconSize:[22,22],iconAnchor:[11,11]}),interactive:false,zIndexOffset:2000}).addTo(map);
    else meMarker.setLatLng([pos.lat,pos.lng]);
  }

  // A point placed in the middle of the part of the map the sheet doesn't cover (phones).
  function above(p,zoom){
    const sheet=$("#busSheet",el);
    if(!map||wide()||!sheet) return L.latLng(p.lat,p.lng);
    return map.unproject(map.project(L.latLng(p.lat,p.lng),zoom).add([0,sheet.offsetHeight/2]),zoom);
  }

  // Keep what matters out from under the sheet (phones) or the list (computers).
  function fitTo(points,{maxZoom=17}={}){
    if(!map||!points.length) return;
    const sheet=$("#busSheet",el);
    const pad=wide()?{paddingTopLeft:[40,40],paddingBottomRight:[40,40]}:{paddingTopLeft:[30,30],paddingBottomRight:[30,(sheet?.offsetHeight||0)+20]};
    map.flyToBounds(L.latLngBounds(points),{...pad,maxZoom,duration:.6});
  }

  /* ---------- Stops in the area ---------- */

  async function stopsAround(c){
    const nus=nearestNusStops(c,6).filter(s=>s.distance<800);
    const pub=(await loadPublicStops()).map(s=>({...s,distance:distanceM(c,s)})).filter(s=>s.distance<600).sort((a,b)=>a.distance-b.distance).slice(0,10);
    return [...nus,...pub].sort((a,b)=>a.distance-b.distance).slice(0,12);
  }

  async function listArea(c){
    const near=pos&&distanceM(pos,c)<250;
    const stops=await stopsAround(near?pos:c);
    if(pos) stops.forEach(s=>s.distance=distanceM(pos,s));
    area={stops,near,center:c};
    if(activeView==="buses"&&!service) render({keepMap:true});
  }

  async function findNearby(fresh=false){
    try{
      pos=await getPosition({fresh});
      area={stops:await stopsAround(pos),near:true,center:pos};
      area.stops.forEach(s=>s.distance=distanceM(pos,s));
      // The nearest two open by themselves the first time.
      if(!open.size) area.stops.slice(0,2).forEach(s=>open.add(keyOf(s)));
      if(map){ map._userMoved=false; showMe(); map.setView(above(pos,17),17,{animate:false}); }
    }catch(err){ area={stops:[],error:`${err.message} Turn on location access to see stops near you.`}; }
    if(activeView==="buses") render({keepMap:true});
  }

  /* ---------- A stop ---------- */

  function selectStop(s,{fromMap=false}={}){
    selected=s; service=null; clearRoute();
    open.add(keyOf(s));
    if(!(area?.stops||[]).some(x=>keyOf(x)===keyOf(s))&&!isFav(s)) searched=s;
    render({keepMap:true});
    if(!fromMap&&map){ const z=Math.max(map.getZoom(),17); map.flyTo(above(s,z),z,{duration:.5}); }
    requestAnimationFrame(()=>$(`.bus-card[data-key="${CSS.escape(keyOf(s))}"]`,el)?.scrollIntoView({block:"nearest",behavior:"smooth"}));
  }

  async function loadBoard(s){
    const k=keyOf(s);
    let html;
    try{
      const rows=s.type==="nus"?await loadShuttleArrivals(s.code):await loadPublicArrivals(s.code);
      boards.set(k,rows);
      html=rows.length?etaRowsHTML(rows,{tap:true}):`<div class="empty-inline">No buses right now.</div>`;
    }catch(err){
      html=s.type==="nus"&&!isNativeApp()?await arrivalsHTML(s,{embed:true}):`<div class="empty-inline">Live times unavailable right now. Tap refresh to try again.</div>`;
    }
    loaded.set(k,`${html}<p class="bus-updated">Updated ${clockTime(new Date())}${boards.get(k)?.length?" · tap a bus for its route":""}</p>`);
    $$(`[data-body="${CSS.escape(k)}"]`,el).forEach(b=>{ b.innerHTML=loaded.get(k); bindRows(b,s); });
  }

  function bindRows(box,s){
    $$("[data-svc]",box).forEach(b=>b.onclick=()=>openService(s,b.dataset.svc));
  }

  /* ---------- A service: route and live buses ---------- */

  function clearRoute(){ if(routeLayer){ routeLayer.remove(); routeLayer=null; } }

  // Which way the service runs through this stop: the direction its next bus is heading
  // (LTA gives the destination stop), else the first direction that calls here.
  function direction(svc,code,dest){
    const dirs=svc?.routes||[];
    const calls=dirs.map((r,i)=>r.includes(code)?i:-1).filter(i=>i>=0);
    return calls.find(i=>dest&&dirs[i].at(-1)===dest) ?? calls[0] ?? 0;
  }

  // Index on a line nearest to a point.
  const nearestOn=(line,p)=>{ let best=0,bd=Infinity; line.forEach(([a,b],i)=>{ const d=(a-p.lat)**2+(b-p.lng)**2; if(d<bd){bd=d;best=i;} }); return best; };

  async function openService(stop,svcNo){
    service={stop,no:svcNo,loading:true};
    render({keepMap:true});
    try{
      const rows=boards.get(keyOf(stop))||[];
      const row=rows.find(r=>String(r.service)===String(svcNo));
      if(stop.type==="nus"){
        const codes=SHUTTLE_ROUTES[svcNo]||[];
        const at=codes.indexOf(stop.code);
        const seq=at>=0?[...codes.slice(0,at+1)]:codes;
        service={stop,no:svcNo,kind:"nus",to:NUS_STOPS.find(s=>s.code===codes.at(-1))?.name||"",
          stops:seq.map(c=>NUS_STOPS.find(s=>s.code===c)).filter(Boolean),row};
      }else{
        const [svcs,lines,all]=await Promise.all([loadBusServices(),loadBusRouteLines(),loadPublicStops()]);
        const svc=svcs[svcNo];
        if(!svc) throw new Error("No route for this service.");
        const byCode=new Map(all.map(s=>[s.code,s]));
        const dir=direction(svc,stop.code,row?.buses?.find(b=>b.dest)?.dest);
        const codes=svc.routes[dir]||[];
        const at=codes.indexOf(stop.code);
        const line=decodePolyline(lines[svcNo]?.[dir]||"",5);
        const stopsSeq=codes.map(c=>byCode.get(c)).filter(Boolean);
        service={stop,no:svcNo,kind:"public",to:byCode.get(codes.at(-1))?.name||svc.name,line,stops:stopsSeq,at:Math.max(0,stopsSeq.findIndex(s=>s.code===stop.code)),row,codes};
      }
    }catch(err){ service={stop,no:svcNo,error:err.message||"Couldn't load this route."}; }
    if(activeView==="buses"&&service?.stop===stop){ render({keepMap:true}); drawService(true); }
  }

  // Buses approaching the stop, with how many stops away each is (from its live position).
  function approaching(){
    const s=service; if(!s?.row) return [];
    return s.row.times.map((m,i)=>{
      const b=s.row.buses?.[i]||{};
      let away=null;
      if(b.lat&&s.stops?.length&&s.kind==="public"){
        const before=s.stops.slice(0,s.at+1);
        let best=0,bd=Infinity; before.forEach((x,j)=>{ const d=distanceM(b,x); if(d<bd){bd=d;best=j;} });
        away=Math.max(0,s.at-best);
      }
      return {m,b,away,live:!!b.lat};
    });
  }

  function drawService(fit=false){
    clearRoute(); pins.clearLayers();
    const s=service; if(!map||!s||s.loading||s.error) return;
    const color=s.kind==="nus"?(SHUTTLE_COLORS[s.no]||"#ef4444"):"#16a34a";
    const layers=[], buses=approaching().filter(x=>x.live);
    if(s.kind==="public"&&s.line.length){
      const end=nearestOn(s.line,s.stop);
      // Faint whole route; bold from the furthest approaching bus (or ten stops back) to your stop.
      const fromPt=buses.length?buses.reduce((a,x)=>(x.away??0)>(a.away??0)?x:a).b:s.stops[Math.max(0,s.at-10)];
      const start=Math.min(end,nearestOn(s.line.slice(0,end+1),fromPt));
      layers.push(L.polyline(s.line,{color,weight:3,opacity:.25}));
      layers.push(L.polyline(s.line.slice(start,end+1),{color:"#fff",weight:8,opacity:.9}),L.polyline(s.line.slice(start,end+1),{color,weight:5}));
      const first=Math.max(0,s.at-(buses.length?Math.max(...buses.map(x=>x.away??0)):10));
      s.stops.slice(first,s.at).forEach(x=>layers.push(L.circleMarker([x.lat,x.lng],{radius:4,color,weight:2,fillColor:"#fff",fillOpacity:1}).bindTooltip(x.name)));
    }else if(s.stops?.length>1){
      layers.push(L.polyline(s.stops.map(x=>[x.lat,x.lng]),{color,weight:4,opacity:.8,dashArray:"6 6"}));
      s.stops.forEach(x=>layers.push(L.circleMarker([x.lat,x.lng],{radius:4,color,weight:2,fillColor:"#fff",fillOpacity:1}).bindTooltip(x.name)));
    }
    layers.push(L.marker([s.stop.lat,s.stop.lng],{icon:pinIcon(s.stop,{on:true}),zIndexOffset:900}));
    buses.forEach(x=>layers.push(L.marker([x.b.lat,x.b.lng],{zIndexOffset:1000,icon:L.divIcon({className:"",iconSize:null,iconAnchor:[22,13],
      html:`<div class="bus-live" style="--c:${color}">${icon(BUS_ICON,12)}<b>${x.m<=0?"Arr":`${x.m} min`}</b></div>`})})));
    routeLayer=L.layerGroup(layers).addTo(map);
    if(fit) fitTo([[s.stop.lat,s.stop.lng],...buses.map(x=>[x.b.lat,x.b.lng]),...(buses.length?[]:(s.stops||[]).slice(Math.max(0,(s.at??0)-6),(s.at??0)+1).map(x=>[x.lat,x.lng]))],{maxZoom:16});
  }

  async function refreshService(){
    const s=service; if(!s||s.loading||s.error) return;
    try{
      const rows=s.stop.type==="nus"?await loadShuttleArrivals(s.stop.code):await loadPublicArrivals(s.stop.code);
      boards.set(keyOf(s.stop),rows);
      if(service!==s) return;
      s.row=rows.find(r=>String(r.service)===String(s.no));
      renderSheet(); drawService(false);
    }catch{}
  }

  /* ---------- Sheet ---------- */

  function stopCardHTML(s,{section}){
    const k=keyOf(s), on=open.has(k), sel=selected&&keyOf(selected)===k;
    const where=[s.type==="nus"?"NUS shuttle":`Stop ${s.code}`,s.road,s.distance!=null?distanceLabel(s.distance):""].filter(Boolean).join(" · ");
    return `<div class="card bus-card ${on?"open":""} ${sel?"selected":""}" data-key="${esc(k)}" data-section="${section}">
      <div class="bus-card-head">
        <button class="bus-card-title" data-toggle="${esc(k)}">
          <span class="bus-stop-icon ${s.type}">${icon(BUS_ICON,16)}</span>
          <span><b>${esc(s.name)}</b><small>${esc(where)}</small></span>
        </button>
        <button class="icon-btn star ${isFav(s)?"on":""}" data-fav="${esc(k)}" aria-label="${isFav(s)?"Remove from":"Add to"} favourites">${icon("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",18)}</button>
        <button class="icon-btn chev" data-toggle="${esc(k)}" aria-label="Show or hide times">${icon("M6 9l6 6 6-6",18)}</button>
      </div>
      ${on?`<div class="bus-card-body" data-body="${esc(k)}">${loaded.get(k)||`<div class="empty-inline"><span class="spinner sm"></span>Loading times…</div>`}</div>`:""}
    </div>`;
  }

  function allStops(){
    const out=[], seen=new Set();
    for(const [section,list] of [["searched",searched?[searched]:[]],["fav",state.busFavs||[]],["near",area?.stops||[]]])
      for(const s of list){ const k=`${section}|${keyOf(s)}`; if(seen.has(k)) continue; seen.add(k); out.push({s,section}); }
    return out;
  }

  function serviceHTML(){
    const s=service;
    const head=`<div class="svc-head">
      <button class="link" id="svcBack">‹ ${esc(s.stop.name)}</button>
      <div class="svc-title"><span class="route-badge ${s.stop.type==="nus"?`nus r-${esc(String(s.no).replace(/[^A-Za-z0-9]/g,""))}`:"public"}">${esc(s.no)}</span>
        <b>${s.to?`to ${esc(s.to)}`:"Route"}</b></div>
      <small>At ${esc(s.stop.name)}</small></div>`;
    if(s.loading) return `${head}<div class="empty-inline"><span class="spinner sm"></span>Loading the route…</div>`;
    if(s.error) return `${head}<div class="empty-inline">${esc(s.error)}</div>`;
    const list=approaching();
    return `${head}
      ${list.length?`<div class="card flush svc-buses">${list.map(x=>`<div class="svc-bus">
          <b>${x.m<=0?"Arriving":`${x.m} min`}</b>
          <span>${esc([BUS_TYPES[x.b.type],BUS_LOADS[x.b.load]].filter(Boolean).join(" · ")||(s.kind==="nus"?"NUS shuttle":""))}</span>
          <small>${x.away!=null?(x.away===0?"at your stop":`${x.away} stop${x.away===1?"":"s"} away`):x.live?"on the map":"position not tracked"}</small>
        </div>`).join("")}</div>`:`<div class="empty-inline">No ${esc(s.no)} coming right now.</div>`}
      <p class="bus-updated">${s.kind==="nus"?"NUS shuttle stops shown; live shuttle positions aren't available.":"Live positions from LTA, updated every 20 seconds."}</p>`;
  }

  function sheetHTML(){
    if(service) return serviceHTML();
    const favs=state.busFavs||[], favKeys=new Set(favs.map(keyOf));
    const areaList=(area?.stops||[]).filter(s=>!favKeys.has(keyOf(s)));
    return `<div class="bus-search">
        ${icon("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",18)}
        <input id="busSearch" type="search" placeholder="Search stop name, number or road" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
        <div id="busResults" class="bus-results" hidden></div>
      </div>
      ${searched?`<h3 class="section-title">Searched</h3>${stopCardHTML(searched,{section:"searched"})}`:""}
      <h3 class="section-title">Favourites</h3>
      ${favs.length?favs.map(s=>stopCardHTML(s,{section:"fav"})).join(""):`<div class="empty-inline">Tap the star on a stop to keep it here.</div>`}
      <h3 class="section-title">${area&&!area.near&&area.center?"In this area":"Near you"}${area&&!area.near&&pos?` <button class="link" id="busNearMe">Back to me</button>`:""}</h3>
      ${area==null?`<div class="empty-inline"><span class="spinner sm"></span>Finding stops near you…</div>`
        :area.error?`<div class="empty-inline">${esc(area.error)}</div>`
        :areaList.map(s=>stopCardHTML(s,{section:"near"})).join("")||`<div class="empty-inline">No other stops here. Move the map to look around.</div>`}`;
  }

  function renderSheet(){
    const body=$("#busSheetBody",el); if(!body) return;
    body.innerHTML=sheetHTML();
    bindSheet();
    if(!service) loadOpen();
  }

  function render({keepMap=false}={}){
    if(!keepMap||!$("#busMap",el)){
      el.innerHTML=`
        <div id="busMap" class="bus-map"></div>
        <button class="map-fab bus-locate" id="busLocate" aria-label="My location">${icon("M12 2v3M12 19v3M2 12h3M19 12h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",22)}</button>
        <div class="bus-sheet" id="busSheet" ${sheetH&&!wide()?`style="height:${sheetH}px"`:""}>
          <button class="sheet-handle" id="busHandle" aria-label="Resize"><span class="sheet-grabber"></span></button>
          <div class="bus-sheet-head"><h1>Buses</h1><button class="icon-btn" id="busRefresh" aria-label="Refresh">${icon("M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",20)}</button></div>
          <div id="busSheetBody" class="bus-sheet-body"></div>
        </div>`;
      map=null; base=null; baseStyle=""; meMarker=null; routeLayer=null;
      initMap(); showMe();
      if(area?.center) map.setView(above(area.center,17),17,{animate:false});
      bindChrome();
    }
    renderSheet();
    drawPins();
    if(service) drawService(false);
  }

  function bindChrome(){
    $("#busRefresh",el).onclick=()=>{ loaded.clear(); if(service) refreshService(); else findNearby(true); };
    $("#busLocate",el).onclick=()=>{ service=null; clearRoute(); findNearby(true); };
    // Drag the handle to give the map or the list more room.
    const sheet=$("#busSheet",el), handle=$("#busHandle",el);
    let y0=null,h0=0;
    handle.addEventListener("pointerdown",e=>{ if(wide()) return; y0=e.clientY; h0=sheet.offsetHeight; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener("pointermove",e=>{ if(y0==null) return; const max=el.offsetHeight-90; sheetH=Math.max(160,Math.min(max,h0+(y0-e.clientY))); sheet.style.height=`${sheetH}px`; });
    handle.addEventListener("pointerup",()=>{ if(y0==null) return; y0=null; map?.invalidateSize(); });
    handle.addEventListener("click",()=>{ if(wide()||y0!=null) return; });
  }

  function bindSheet(){
    const body=$("#busSheetBody",el);
    if(service){
      $("#svcBack",body).onclick=()=>{ const s=service.stop; service=null; clearRoute(); selected=s; render({keepMap:true}); fitTo([[s.lat,s.lng]]); };
      return;
    }
    $("#busNearMe",body)?.addEventListener("click",()=>{ if(!pos) return; map._userMoved=false; map.flyTo(above(pos,17),17,{duration:.5}); listArea(pos); });
    $$("[data-toggle]",body).forEach(b=>b.onclick=()=>{
      const k=b.dataset.toggle, s=allStops().find(x=>keyOf(x.s)===k)?.s;
      if(open.has(k)&&selected&&keyOf(selected)===k){ open.delete(k); selected=null; renderSheet(); drawPins(); return; }
      if(s) selectStop(s);
    });
    $$("[data-fav]",body).forEach(b=>b.onclick=()=>{
      const k=b.dataset.fav, s=allStops().find(x=>keyOf(x.s)===k)?.s;
      if(!s) return;
      if(isFav(s)) state.busFavs=state.busFavs.filter(f=>keyOf(f)!==k);
      else{ state.busFavs=[...(state.busFavs||[]),{type:s.type,code:s.code,name:s.name,lat:s.lat,lng:s.lng,road:s.road||""}]; open.add(k); }
      save(); renderSheet(); drawPins();
    });
    $$("[data-body]",body).forEach(b=>{ const s=allStops().find(x=>keyOf(x.s)===b.dataset.body)?.s; if(s) bindRows(b,s); });
    const input=$("#busSearch",body), box=$("#busResults",body);
    let t=null;
    input.oninput=()=>{
      clearTimeout(t);
      const q=input.value.trim();
      if(q.length<2){ box.hidden=true; box.innerHTML=""; return; }
      t=setTimeout(async()=>{
        const rows=await searchStops(q);
        if(input.value.trim()!==q) return;
        box.hidden=false;
        box.innerHTML=rows.length?rows.map((s,i)=>`<button class="bus-result" data-i="${i}"><b>${esc(s.name)}</b><small>${esc(s.type==="nus"?"NUS shuttle":`${s.code}${s.road?` · ${s.road}`:""}`)}</small></button>`).join("")
          :`<div class="empty-inline">No stops match “${esc(q)}”.</div>`;
        $$(".bus-result",box).forEach(b=>b.onclick=()=>{
          const s=rows[+b.dataset.i];
          input.value=""; box.hidden=true;
          searched=s; selectStop(s);
        });
      },150);
    };
  }

  // NUS stops and public stops by name, number or road.
  async function searchStops(query){
    const q=normaliseCode(query);
    const rows=[];
    for(const s of NUS_STOPS){ const sc=scoreMatch(q,s.code,s.name); if(sc) rows.push({...s,score:sc+10}); }
    for(const s of await loadPublicStops()){
      const sc=Math.max(scoreMatch(q,s.code,s.name),scoreMatch(q,s.road,"")-15);
      if(sc>=40) rows.push({...s,score:sc});
    }
    if(pos) rows.forEach(r=>r.distance=distanceM(pos,r));
    return rows.sort((a,b)=>b.score-a.score||(a.distance??0)-(b.distance??0)).slice(0,12);
  }

  // Fetches the boards that are open and drops them in without re-rendering.
  function loadOpen(){
    for(const {s} of allStops()) if(open.has(keyOf(s))) loadBoard(s);
  }

  return {
    title:"Buses",
    keepScroll:true,
    mount(c){ el=c; },
    show(params){
      if(params.stop){
        const nus=NUS_STOPS.find(s=>s.code===params.stop);
        if(nus){ searched=nus; selected=nus; open.add(keyOf(nus)); }
      }
      render({keepMap:true});
      setTimeout(()=>map?.invalidateSize(),50);
      if(area==null||area.error) findNearby();
      clearInterval(timer);
      timer=setInterval(()=>{
        if(activeView!=="buses"){ clearInterval(timer); return; }
        if(document.hidden) return;
        if(service) refreshService(); else loadOpen();
      },20000);
    },
    refresh(){ if(document.activeElement?.id!=="busSearch"&&!service){ renderSheet(); drawPins(); } }
  };
})();
