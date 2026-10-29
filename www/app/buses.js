/* Buses tab: live arrivals like SingaBus. Starred stops first, then the
 * stops nearest you (NUS shuttle and public), each with every service's next
 * three buses, deck type and how full they are. Search any stop by name,
 * code or road. Open boards refresh every 20 seconds while the tab is shown.
 *   state.busFavs: [{type:"nus"|"public", code, name, lat, lng, road}]
 */

views.buses=(()=>{
  let el=null, timer=null, pos=null, nearby=null, searched=null;
  const open=new Set();      // keys of boards that are expanded
  const loaded=new Map();    // key -> last board HTML, so re-renders don't flash
  const keyOf=s=>`${s.type}:${s.code}`;
  const isFav=s=>(state.busFavs||[]).some(f=>keyOf(f)===keyOf(s));

  function stopCardHTML(s,{section}){
    const k=keyOf(s), on=open.has(k);
    const where=[s.type==="nus"?"NUS shuttle":`Stop ${s.code}`,s.road,s.distance!=null?distanceLabel(s.distance):""].filter(Boolean).join(" · ");
    return `<div class="card bus-card ${on?"open":""}" data-key="${esc(k)}" data-section="${section}">
      <div class="bus-card-head">
        <button class="bus-card-title" data-toggle="${esc(k)}">
          <span class="bus-stop-icon ${s.type}">${icon("M8 6v6M16 6v6M2 12h20M7 18h.01M17 18h.01M6 3h12a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z",16)}</span>
          <span><b>${esc(s.name)}</b><small>${esc(where)}</small></span>
        </button>
        <button class="icon-btn star ${isFav(s)?"on":""}" data-fav="${esc(k)}" aria-label="${isFav(s)?"Remove from":"Add to"} favourites">${icon("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",18)}</button>
        <button class="icon-btn chev" data-toggle="${esc(k)}" aria-label="Show or hide times">${icon("M6 9l6 6 6-6",18)}</button>
      </div>
      ${on?`<div class="bus-card-body" data-body="${esc(k)}">${loaded.get(k)||`<div class="empty-inline"><span class="spinner sm"></span>Loading times…</div>`}</div>`:""}
    </div>`;
  }

  function allStops(){
    const seen=new Set(), out=[];
    for(const [section,list] of [["searched",searched?[searched]:[]],["fav",state.busFavs||[]],["near",nearby||[]]])
      for(const s of list){ const k=keyOf(s); if(seen.has(`${section}|${k}`)) continue; seen.add(`${section}|${k}`); out.push({s,section}); }
    return out;
  }

  function render(){
    const favs=state.busFavs||[];
    const favKeys=new Set(favs.map(keyOf));
    el.innerHTML=`${pageHeader("Buses",{eyebrow:"Live arrivals",actions:`<button class="icon-btn" id="busRefresh" aria-label="Refresh">${icon("M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",20)}</button>`})}
      <div class="bus-search">
        ${icon("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",18)}
        <input id="busSearch" type="search" placeholder="Search stop name, number or road" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
        <div id="busResults" class="bus-results" hidden></div>
      </div>
      ${searched?`<h3 class="section-title">Searched</h3>${stopCardHTML(searched,{section:"searched"})}`:""}
      <h3 class="section-title">Favourites</h3>
      ${favs.length?favs.map(s=>stopCardHTML(s,{section:"fav"})).join(""):`<div class="empty-inline">Tap the star on a stop to keep it here.</div>`}
      <h3 class="section-title">Near you</h3>
      ${nearby==null?`<div class="empty-inline"><span class="spinner sm"></span>Finding stops near you…</div>`
        :nearby.error?`<div class="empty-inline">${esc(nearby.error)}</div>`
        :nearby.filter(s=>!favKeys.has(keyOf(s))).map(s=>stopCardHTML(s,{section:"near"})).join("")||`<div class="empty-inline">No other stops within 600 m.</div>`}`;
    bind();
    loadOpen();
  }

  function bind(){
    $$("[data-toggle]",el).forEach(b=>b.onclick=()=>{
      const k=b.dataset.toggle;
      if(open.has(k)) open.delete(k); else open.add(k);
      render();
    });
    $$("[data-fav]",el).forEach(b=>b.onclick=()=>{
      const k=b.dataset.fav, s=allStops().find(x=>keyOf(x.s)===k)?.s;
      if(!s) return;
      if(isFav(s)) state.busFavs=state.busFavs.filter(f=>keyOf(f)!==k);
      else{ state.busFavs=[...(state.busFavs||[]),{type:s.type,code:s.code,name:s.name,lat:s.lat,lng:s.lng,road:s.road||""}]; open.add(k); }
      save(); render();
    });
    $("#busRefresh",el).onclick=()=>{ loaded.clear(); findNearby(true); };
    const input=$("#busSearch",el), box=$("#busResults",el);
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
          searched=rows[+b.dataset.i]; open.add(keyOf(searched));
          input.value=""; box.hidden=true; render(); window.scrollTo({top:0,behavior:"smooth"});
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
    if(lastPosition) rows.forEach(r=>r.distance=distanceM(lastPosition,r));
    return rows.sort((a,b)=>b.score-a.score||(a.distance??0)-(b.distance??0)).slice(0,12);
  }

  async function findNearby(fresh=false){
    try{
      pos=await getPosition({fresh});
      const nus=nearestNusStops(pos,6).filter(s=>s.distance<800);
      const pub=(await loadPublicStops()).map(s=>({...s,distance:distanceM(pos,s)})).filter(s=>s.distance<600).sort((a,b)=>a.distance-b.distance).slice(0,8);
      nearby=[...nus,...pub].sort((a,b)=>a.distance-b.distance).slice(0,10);
      // The nearest two open by themselves the first time.
      if(!open.size) nearby.slice(0,2).forEach(s=>open.add(keyOf(s)));
    }catch(err){ nearby={error:`${err.message} Turn on location access to see stops near you.`}; }
    if(activeView==="buses") render();
  }

  // Fetches the boards that are open and drops them in without re-rendering.
  function loadOpen(){
    for(const {s} of allStops()){
      const k=keyOf(s);
      if(!open.has(k)) continue;
      arrivalsHTML(s,{embed:true}).then(html=>{
        loaded.set(k,`${html}<p class="bus-updated">Updated ${clockTime(new Date())}</p>`);
        $$(`[data-body="${CSS.escape(k)}"]`,el).forEach(b=>b.innerHTML=loaded.get(k));
      });
    }
  }

  return {
    title:"Buses",
    mount(c){ el=c; },
    show(params){
      if(params.stop){
        const nus=NUS_STOPS.find(s=>s.code===params.stop);
        if(nus){ searched=nus; open.add(keyOf(nus)); }
      }
      render();
      if(nearby==null||nearby.error) findNearby();
      clearInterval(timer);
      timer=setInterval(()=>{ if(activeView==="buses"&&!document.hidden) loadOpen(); else if(activeView!=="buses") clearInterval(timer); },20000);
    },
    refresh(){ if(document.activeElement?.id!=="busSearch") render(); }
  };
})();
