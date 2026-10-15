/* Map tab: one search bar for venues, NUS shuttle stops, public bus stops and
 * any place in Singapore. Selecting something opens a panel at the bottom of
 * the map with live bus arrivals and directions - no page changes.
 */

views.map=(()=>{
  let el=null, map=null, ready=false;
  let nusMarkers=new Map(), publicLayer=null, pinMarker=null, meMarker=null, watchId=null;
  let selected=null, refreshTimer=null, searchTimer=null, pendingParams=null;

  /* ---------- Markers ---------- */

  const nusIcon=(on=false)=>L.divIcon({className:"",html:`<div class="mk-nus ${on?"on":""}">${icon("M8 6v6M16 6v6M2 12h20M7 18h.01M17 18h.01M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z",14)}</div>`,iconSize:[28,28],iconAnchor:[14,14]});
  const publicIcon=()=>L.divIcon({className:"",html:`<div class="mk-public"></div>`,iconSize:[14,14],iconAnchor:[7,7]});
  const pinIcon=()=>L.divIcon({className:"",html:`<div class="mk-pin"></div>`,iconSize:[30,40],iconAnchor:[15,38]});
  const meIcon=()=>L.divIcon({className:"",html:`<div class="mk-me"><span></span></div>`,iconSize:[22,22],iconAnchor:[11,11]});

  function initMap(){
    map=L.map($("#mapCanvas",el),{zoomControl:false,attributionControl:true}).setView([NUS_CENTER.lat,NUS_CENTER.lng],16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,
      attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    publicLayer=L.layerGroup().addTo(map);

    for(const s of NUS_STOPS){
      const m=L.marker([s.lat,s.lng],{icon:nusIcon(),title:s.name,zIndexOffset:500}).addTo(map);
      m.on("click",()=>selectStop(s));
      nusMarkers.set(s.code,m);
    }
    map.on("moveend",renderPublicStops);
    map.on("click",()=>{ hideResults(); });
    loadPublicStops().then(renderPublicStops);
    ready=true;
  }

  // Public stops only when zoomed in, so the map stays readable.
  async function renderPublicStops(){
    publicLayer.clearLayers();
    if(map.getZoom()<16) return;
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

  function openPanel(html){
    const p=$("#mapPanel",el);
    p.innerHTML=`<div class="sheet-grabber"></div><button class="panel-close" aria-label="Close">${icon("M6 6l12 12M18 6 6 18",18)}</button>${html}`;
    p.hidden=false;
    el.classList.add("panel-open");
    $(".panel-close",p).onclick=closePanel;
  }

  // Centre a point in the part of the map the panel doesn't cover.
  function focusOn(p,zoom){
    map.setView([p.lat,p.lng],zoom,{animate:false});
    const panel=$("#mapPanel",el);
    const wide=matchMedia("(min-width:900px)").matches;
    if(!panel.hidden && !wide) map.panBy([0,panel.offsetHeight/2],{animate:false});
  }

  function closePanel(){
    clearInterval(refreshTimer);
    $("#mapPanel",el).hidden=true;
    el.classList.remove("panel-open");
    if(selected?.type==="nus") nusMarkers.get(selected.code)?.setIcon(nusIcon());
    if(pinMarker){ pinMarker.remove(); pinMarker=null; }
    selected=null;
  }

  function distanceText(p){
    return lastPosition?` · ${distanceLabel(distanceM(lastPosition,p))} away`:"";
  }

  function directionsButtons(p){
    const dest=`${p.lat},${p.lng}`;
    const name=encodeURIComponent(p.name&&p.name!==p.code?`${p.code}, ${p.name}`:p.code);
    return `<div class="dir-row">
      <a class="btn primary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=transit">${icon("M3 11l19-9-9 19-2-8-8-2z",16)}Directions</a>
      <a class="btn secondary" target="_blank" rel="noopener" href="https://maps.apple.com/?daddr=${dest}&q=${name}&dirflg=w">Apple Maps</a>
      <a class="btn secondary" target="_blank" rel="noopener" href="https://citymapper.com/directions?endcoord=${dest}&endname=${name}">Citymapper</a>
    </div>`;
  }

  async function selectStop(stop){
    clearInterval(refreshTimer);
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
    const twin=stop.type==="nus" ? await publicStopNear(stop) : NUS_STOPS.find(n=>distanceM(n,stop)<45);
    const boardsHTML=()=>Promise.all([arrivalsHTML(stop),twin?arrivalsHTML(twin):""]);

    openPanel(`<p class="kicker">${stop.type==="nus"?"NUS SHUTTLE STOP":`BUS STOP ${esc(stop.code)}`}</p>
      <div class="panel-title"><h2>${esc(stop.name)}</h2><button class="icon-btn sm" id="refreshEta" aria-label="Refresh">${icon("M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",18)}</button></div>
      <p class="subtle">${[stop.type==="public"&&stop.road?esc(stop.road):"",distanceText(stop).replace(/^ · /,"")].filter(Boolean).join(" · ")}</p>
      <div id="etaMain"><div class="empty-inline"><span class="spinner sm"></span>Loading live times…</div></div>
      ${twin?`<h4 class="sub-head">${twin.type==="nus"?"NUS shuttles here":"Public buses here"}<small>${esc(twin.type==="nus"?twin.name:`${twin.name} · ${twin.code}`)}</small></h4><div id="etaTwin"></div>`:""}
      <p class="updated" id="etaUpdated"></p>`);

    focusOn(stop,Math.max(map.getZoom(),17));
    const load=async()=>{
      const [main,other]=await boardsHTML();
      if(selected!==stop) return;
      $("#etaMain",el).innerHTML=main;
      if(twin) $("#etaTwin",el).innerHTML=other;
      $("#etaUpdated",el).textContent=`Updated ${new Date().toLocaleTimeString("en-SG",{hour:"numeric",minute:"2-digit"})} · refreshes automatically`;
    };
    $("#refreshEta",el).onclick=load;
    load();
    refreshTimer=setInterval(()=>{ if(activeView==="map"&&!document.hidden) load(); },30000);
  }

  async function selectPlace(p){
    clearInterval(refreshTimer);
    if(selected?.type==="nus") nusMarkers.get(selected.code)?.setIcon(nusIcon());
    if(pinMarker) pinMarker.remove();
    selected=p;
    hideResults();
    pinMarker=L.marker([p.lat,p.lng],{icon:pinIcon(),zIndexOffset:1000}).addTo(map);
    const near=nearestNusStops(p,1)[0];
    const showShuttle=near && near.distance<800;
    openPanel(`<p class="kicker">${esc(placeKindLabel(p).toUpperCase())}${p.floor!=null?` · LEVEL ${esc(String(p.floor))}`:""}</p>
      <h2>${esc(p.code)}</h2>
      ${p.name&&p.name!==p.code?`<p class="subtle">${esc(p.name)}</p>`:""}
      <p class="subtle">${distanceText(p).replace(/^ · /,"")}</p>
      ${directionsButtons(p)}
      ${showShuttle?`<h4 class="sub-head">Nearest shuttle stop<button class="link" id="openNear">${esc(near.name)} · ${distanceLabel(near.distance)}</button></h4>
        <div id="etaNear"><div class="empty-inline"><span class="spinner sm"></span>Loading live times…</div></div>`:""}`);
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

  function hideResults(){ const r=$("#mapResults",el); if(r){ r.hidden=true; r.innerHTML=""; } }

  function showResults(rows,{query="",searching=false}={}){
    const r=$("#mapResults",el);
    r.hidden=false;
    r.innerHTML=rows.map((p,i)=>`
      <button class="result-row" data-i="${i}">
        <span class="result-icon t-${p.type}">${p.type==="nus"||p.type==="public"?icon("M8 6v6M16 6v6M2 12h20M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z",16):icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z",16)}</span>
        <span><b>${esc(p.type==="public"?p.name:p.code)}</b><small>${esc(p.type==="public"?`Bus stop ${p.code}${p.road?` · ${p.road}`:""}`:p.name!==p.code?`${placeKindLabel(p)} · ${p.name}`:placeKindLabel(p))}</small></span>
      </button>`).join("")
      +(searching?`<div class="result-status"><span class="spinner sm"></span>Searching the map…</div>`
        :query.length>=3?`<button class="result-row more" id="searchWider"><span class="result-icon">${icon("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",16)}</span><span><b>Search all of Singapore</b><small>Addresses, malls, MRT stations…</small></span></button>`:"");
    $$(".result-row[data-i]",r).forEach(b=>b.onclick=()=>choose(rows[+b.dataset.i]));
    $("#searchWider",r)?.addEventListener("click",()=>searchWide(query,rows));
  }

  async function choose(p){
    $("#mapSearch",el).blur();
    if(p.type==="nus"||p.type==="public") return selectStop(p);
    if(p.lat==null){
      const loc=await resolveVenue(p.code);
      if(!loc){ toast(`Couldn't find ${p.code} on the map`); return; }
      p={...p,lat:loc.lat,lng:loc.lng};
    }
    selectPlace(p);
  }

  async function searchWide(query,localRows=[]){
    showResults(localRows,{query,searching:true});
    const ext=await searchPlacesExternal(query);
    if($("#mapSearch",el).value.trim()!==query) return;
    if(!localRows.length && !ext.length){
      $("#mapResults",el).innerHTML=`<div class="result-status">No results for “${esc(query)}”.</div>`;
      return;
    }
    showResults([...localRows,...ext],{query:""});
  }

  /* ---------- Deep links ---------- */

  async function applyParams(params){
    if(params.stop){
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
          <input id="mapSearch" type="search" placeholder="Search venues, bus stops, places" autocomplete="off" enterkeyhint="search">
          <button class="clear-btn" id="mapClear" hidden aria-label="Clear">${icon("M6 6l12 12M18 6 6 18",16)}</button>
        </div>
        <div id="mapResults" class="map-results" hidden></div>
        <div class="map-chips">
          <button class="chip solid" id="chipNearby">${icon("M8 6v6M16 6v6M2 12h20M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z",14)}Shuttles near me</button>
          ${["UTOWN","CLB","KR-MRT","COM3"].map(c=>`<button class="chip solid" data-stop="${c}">${esc(NUS_STOPS.find(s=>s.code===c).name)}</button>`).join("")}
        </div>
      </div>
      <button class="map-fab" id="locateMe" aria-label="My location">${icon("M12 2v3M12 19v3M2 12h3M19 12h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",22)}</button>
      <div class="map-panel" id="mapPanel" hidden></div>`;

    const input=$("#mapSearch",el);
    input.addEventListener("input",()=>{
      const q=input.value.trim();
      $("#mapClear",el).hidden=!q;
      clearTimeout(searchTimer);
      if(!q){ hideResults(); return; }
      searchTimer=setTimeout(async()=>{
        const rows=await searchPlacesLocal(q,{limit:8});
        if(input.value.trim()===q) showResults(rows,{query:q});
      },120);
    });
    input.addEventListener("keydown",async e=>{
      if(e.key!=="Enter") return;
      e.preventDefault();
      const q=input.value.trim();
      if(!q) return;
      const rows=await searchPlacesLocal(q,{limit:8});
      if(rows[0]?.score>=80) choose(rows[0]);
      else searchWide(q,rows);
    });
    $("#mapClear",el).onclick=()=>{ input.value=""; $("#mapClear",el).hidden=true; hideResults(); input.focus(); };
    $("#chipNearby",el).onclick=showNearby;
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
    mount(c){
      el=c;
      render();
      if(window.L) initMap();
      else toast("The map couldn't load. Check your connection.");
    },
    show(params){
      if(!ready) return;
      // Leaflet measures its container; it was hidden until now.
      setTimeout(()=>map.invalidateSize(),0);
      startLocation();
      if(Object.keys(params).length){
        pendingParams=params;
        setTimeout(()=>{ if(pendingParams===params) applyParams(params); },50);
      }
    }
  };
})();
