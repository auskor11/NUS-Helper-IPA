/* NUS Companion - places: NUS shuttle stops, public bus stops, live arrivals,
 * venue search and the user's location. Used by the Map and Today tabs and by
 * the venue picker in forms.
 */

const NUS_STOPS=[["COM 3","COM3",1.294431,103.775217],["Opp TCOMS","TCOMS-OPP",1.293789,103.776715],["Prince George's Park","PGP",1.291765,103.780419],["Kent Ridge MRT","KR-MRT",1.29482,103.784413],["LT 27","LT27",1.297421,103.780941],["University Hall","UHALL",1.297127,103.778822],["Opp University Health Centre","UHC-OPP",1.298788,103.775612],["Museum","MUSEUM",1.301081,103.77369],["University Town","UTOWN",1.303876,103.774621],["University Health Centre","UHC",1.29891,103.776103],["Opp University Hall","UHALL-OPP",1.297574,103.778088],["S 17","S17",1.297519,103.78073],["Opp Kent Ridge MRT","KR-MRT-OPP",1.294962,103.784556],["Prince George's Park Foyer","PGPR",1.290994,103.781153],["TCOMS","TCOMS",1.293654,103.776898],["Opp HSSML","HSSML-OPP",1.292798,103.774978],["Opp NUSS","NUSS-OPP",1.293208,103.772618],["Ventus","LT13-OPP",1.29534,103.770617],["Information Technology","IT",1.297204,103.772688],["Opp Yusof Ishak House","YIH-OPP",1.298904,103.774118],["Yusof Ishak House","YIH",1.298885,103.774377],["Central Library","CLB",1.296544,103.772569],["LT 13","LT13",1.294552,103.770635],["AS 5","AS5",1.293619,103.771475],["BIZ 2","BIZ2",1.293223,103.775068],["Opp SDE 3","SDE3-OPP",1.297799,103.769603],["The Japanese Primary School","JP-SCH-16151",1.30077,103.769904],["Kent Vale","KV",1.301899,103.769455],["Kent Ridge Bus Terminal","KRB",1.294536,103.77],["Raffles Hall","RAFFLES",1.300946,103.772703],["College Green","CG",1.323337,103.816276],["Oei Tiong Ham Building","OTH",1.319796,103.817774],["Botanic Gardens MRT (PUDO)","BG-MRT",1.322614,103.815914]]
  .map(([name,code,lat,lng])=>({type:"nus",name,code,lat,lng}));

const NUS_CENTER={lat:1.2966,lng:103.7764};
const normaliseCode=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");

function distanceM(a,b){
  const lat=a.lat*Math.PI/180;
  const dy=(b.lat-a.lat)*111320, dx=(b.lng-a.lng)*111320*Math.cos(lat);
  return Math.sqrt(dx*dx+dy*dy);
}

function distanceLabel(m){
  return m<1000 ? `${Math.round(m/10)*10} m` : `${(m/1000).toFixed(1)} km`;
}

function nearestNusStops(pos,n=3){
  return NUS_STOPS.map(s=>({...s,distance:distanceM(pos,s)})).sort((a,b)=>a.distance-b.distance).slice(0,n);
}

/* ---------- HTTP ---------- */

// Some live-data APIs don't send CORS headers. Inside the iOS app we can call
// them natively instead; in a browser those calls fail and callers fall back.
async function getJSON(url,{native=false}={}){
  const http=window.Capacitor?.Plugins?.CapacitorHttp;
  if(native && isNativeApp() && http){
    const r=await http.get({url,headers:{Accept:"application/json"}});
    if(r.status<200||r.status>=300) throw new Error(`Request failed (${r.status})`);
    return typeof r.data==="string" ? JSON.parse(r.data) : r.data;
  }
  const r=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store"});
  if(!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}

/* ---------- Live arrivals ---------- */

const NEXTBUS_SITE="https://bus.hewliyang.com";

// NUS shuttle arrivals from NUS NextBus (bus.hewliyang.com).
// Returns [{service, next, then}] where next/then are minutes or null.
async function loadShuttleArrivals(code){
  const data=await getJSON(`${NEXTBUS_SITE}/api/stop/${encodeURIComponent(code)}`,{native:true});
  const mins=v=>{ const n=parseInt(v,10); return Number.isFinite(n)?n:null; };
  const byService=new Map();
  for(const t of data?.etas?.timings||[]){
    // The API can list the same service twice (e.g. two loops); keep the soonest.
    const row={service:t.name,next:mins(t.arrivalTime),then:mins(t.nextArrivalTime)};
    const prev=byService.get(row.service);
    if(!prev || (row.next??999)<(prev.next??999)) byService.set(row.service,row);
  }
  return [...byService.values()].sort((a,b)=>(a.next??999)-(b.next??999));
}

// Singapore public bus arrivals from arrivelah (BusRouter SG).
async function loadPublicArrivals(code){
  const data=await getJSON(`https://arrivelah2.busrouter.sg/?id=${encodeURIComponent(code)}`);
  const mins=x=>{
    if(!x) return null;
    const ms=Number(x.duration_ms);
    if(Number.isFinite(ms)) return Math.max(0,Math.round(ms/60000));
    const t=new Date(x.time||x.estimatedArrival||"").getTime();
    return Number.isFinite(t) ? Math.max(0,Math.round((t-Date.now())/60000)) : null;
  };
  return (data?.services||[]).map(s=>({service:s.no,next:mins(s.next),then:mins(s.subsequent||s.next2)}))
    .sort((a,b)=>(a.next??999)-(b.next??999));
}

// Arrival board HTML. Shuttle boards fall back to an embedded NextBus page in
// browsers, where the shuttle API is blocked by CORS.
async function arrivalsHTML(stop,{embed=true}={}){
  const isNus=stop.type==="nus";
  try{
    const rows=isNus ? await loadShuttleArrivals(stop.code) : await loadPublicArrivals(stop.code);
    if(!rows.length) return `<div class="empty-inline">No buses right now.</div>`;
    return `<div class="eta-list">${rows.map(r=>`
      <div class="eta-row">
        <span class="route-badge ${isNus?`nus r-${esc(String(r.service).replace(/[^A-Za-z0-9]/g,""))}`:"public"}">${esc(r.service)}</span>
        <span class="eta-next">${r.next==null?"–":r.next<=0?"Arriving":`<b>${r.next}</b> min`}</span>
        <span class="eta-then">${r.then==null?"":r.then<=0?"then arriving":`then ${r.then} min`}</span>
      </div>`).join("")}</div>`;
  }catch(err){
    if(isNus && !isNativeApp() && !embed){
      return `<button class="btn secondary full" data-go="map" data-params='${esc(JSON.stringify({stop:stop.code}))}'>See live shuttle times</button>`;
    }
    if(isNus && !isNativeApp()){
      return `<iframe class="nextbus-frame" title="NUS NextBus" src="${NEXTBUS_SITE}/stop/${encodeURIComponent(stop.code)}" referrerpolicy="no-referrer"></iframe>`;
    }
    console.warn("Arrivals failed",err);
    return `<div class="empty-inline">Live times unavailable right now. Tap refresh to try again.</div>`;
  }
}

/* ---------- Public bus stop catalogue ---------- */

let publicStopsPromise=null;
function loadPublicStops(){
  if(!publicStopsPromise){
    publicStopsPromise=getJSON("https://data.busrouter.sg/v1/stops.min.json").then(data=>
      Object.entries(data||{}).map(([code,v])=>({
        type:"public", code:String(code).padStart(5,"0"),
        lng:Number(v[0]), lat:Number(v[1]), name:String(v[2]||`Bus stop ${code}`), road:String(v[3]||"")
      })).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng))
    ).catch(err=>{ console.warn("Public bus stops unavailable",err); publicStopsPromise=null; return []; });
  }
  return publicStopsPromise;
}

async function publicStopNear(pos,maxM=45){
  const stops=await loadPublicStops();
  let best=null,bestD=Infinity;
  for(const s of stops){ const d=distanceM(pos,s); if(d<bestD){bestD=d;best=s;} }
  return best && bestD<=maxM ? best : null;
}

/* ---------- Location ---------- */

let lastPosition=null;
// The map keeps lastPosition up to date while it's open, so a recent fix is
// reused; if a new reading is slow, fall back to one from the last 5 minutes.
function getPosition({fresh=false}={}){
  const age=lastPosition?Date.now()-lastPosition.at:Infinity;
  if(age<(fresh?20000:60000)) return Promise.resolve(lastPosition);
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error("Location isn't available on this device."));
    navigator.geolocation.getCurrentPosition(p=>{
      lastPosition={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,at:Date.now()};
      resolve(lastPosition);
    },err=>{
      if(err.code!==1 && lastPosition && Date.now()-lastPosition.at<300000) return resolve(lastPosition);
      reject(new Error(err.code===1?"Location permission is off.":"Couldn't get your location."));
    },{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
  });
}

/* ---------- Directions ---------- */

// Walking, cycling and driving routes from OpenStreetMap's routers
// (routing.openstreetmap.de). Returns {distance (m), duration (s),
// path [[lat,lng]...], steps [{text, distance, type, modifier}]}.
const OSM_PROFILES={walk:["routed-foot","foot"],cycle:["routed-bike","bike"],drive:["routed-car","driving"]};

async function loadStreetRoute(mode,from,to){
  const [server,profile]=OSM_PROFILES[mode];
  const url=`https://routing.openstreetmap.de/${server}/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const data=await getJSON(url);
  const r=data?.routes?.[0];
  if(data?.code!=="Ok" || !r) throw new Error("No route found.");
  const steps=(r.legs?.[0]?.steps||[])
    .filter(s=>s.maneuver?.type==="arrive" || s.distance>=5)
    .map(s=>({text:stepText(s),distance:s.distance,type:s.maneuver?.type,modifier:s.maneuver?.modifier||""}));
  return {distance:r.distance,duration:r.duration,path:r.geometry.coordinates.map(([lng,lat])=>[lat,lng]),steps};
}

// Google-style encoded polyline (Transitous uses precision 6).
function decodePolyline(str,precision=6){
  const factor=10**precision, out=[];
  let i=0,lat=0,lng=0;
  while(i<str.length){
    for(const axis of [0,1]){
      let shift=0,result=0,b;
      do{ b=str.charCodeAt(i++)-63; result|=(b&31)<<shift; shift+=5; }while(b>=32);
      const d=result&1?~(result>>1):result>>1;
      if(axis===0) lat+=d; else lng+=d;
    }
    out.push([lat/factor,lng/factor]);
  }
  return out;
}

const MRT_COLORS={EW:"#009645",CG:"#009645",NS:"#d42e12",NE:"#9900aa",CC:"#fa9e0d",CE:"#fa9e0d",DT:"#005ec4",TE:"#9d5b25"};
function lineColor(leg){
  if(leg.mode==="WALK") return "#8b93a5";
  if(leg.mode==="BUS") return "#16a34a";
  return MRT_COLORS[leg.line] || "#748477"; // LRT and anything else
}

function transitLabel(leg){
  if(leg.mode==="BUS") return `Bus ${leg.line}`;
  if(leg.mode==="SUBWAY"||leg.mode==="RAIL"||leg.mode==="METRO") return MRT_COLORS[leg.line]?`${leg.line} line`:`${leg.line} LRT`;
  return leg.line||leg.mode;
}

// Public transport (bus + MRT/LRT) from Transitous, a free community router
// that uses LTA's timetables. Returns up to 4 itineraries:
// {duration, start, end, transfers, walk (m), legs:[{mode, line, headsign,
//  from:{name,code,lat,lng}, to:{...}, start, end, stops, distance, path}]}
async function loadTransitRoutes(from,to){
  const params=new URLSearchParams({fromPlace:`${from.lat},${from.lng}`,toPlace:`${to.lat},${to.lng}`,time:new Date().toISOString(),numItineraries:"5"});
  const data=await getJSON(`https://api.transitous.org/api/v5/plan?${params}`);
  // MRT station names come in capitals ("KENT RIDGE"); show them as "Kent Ridge".
  const tidy=n=>n===n.toUpperCase()?n.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()):n;
  const place=p=>({name:p.name==="START"?"your location":p.name==="END"?"your destination":tidy(p.name),code:p.stopCode||"",lat:p.lat,lng:p.lon});
  const seen=new Set();
  return (data?.itineraries||[]).map(it=>{
    const legs=it.legs.map(l=>({
      mode:l.mode, line:l.routeShortName||l.displayName||"", headsign:tidy(l.headsign||""),
      from:place(l.from), to:place(l.to),
      start:new Date(l.startTime), end:new Date(l.endTime),
      stops:(l.intermediateStops||[]).length+1, distance:l.distance||0, duration:l.duration,
      path:l.legGeometry?.points?decodePolyline(l.legGeometry.points,l.legGeometry.precision||6):[]
    }));
    return {duration:it.duration,start:new Date(it.startTime),end:new Date(it.endTime),transfers:it.transfers,
      walk:legs.filter(l=>l.mode==="WALK").reduce((n,l)=>n+l.distance,0),legs};
  }).filter(it=>{
    if(!it.legs.some(l=>l.mode!=="WALK")) return false;
    const key=it.legs.filter(l=>l.mode!=="WALK").map(l=>l.line).join(">");
    if(seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a.end-b.end).slice(0,4);
}

function stepText(s){
  const m=s.maneuver||{}, mod=m.modifier||"", road=s.name||"";
  const onto=road?` onto ${road}`:"", on=road?` on ${road}`:"";
  const compass=["north","northeast","east","southeast","south","southwest","west","northwest"][Math.round((m.bearing_after||0)/45)%8];
  switch(m.type){
    case "depart": return `Head ${compass}${on}`;
    case "arrive": return "Arrive at your destination";
    case "continue": case "new name": return mod&&mod!=="straight"?`Keep ${mod}${on}`:`Continue${on}`;
    case "roundabout": case "rotary": return `Go around the roundabout${onto}`;
    case "fork": return `Keep ${mod||"straight"} at the fork${onto}`;
    default: return mod==="straight"?`Go straight${on}`:mod?`Turn ${mod}${onto}`:`Continue${on}`;
  }
}

function walkMinutes(seconds){ return Math.max(1,Math.round(seconds/60)); }
function clockTime(d){ return d.toLocaleTimeString("en-SG",{hour:"numeric",minute:"2-digit"}); }

// A shuttle ride between the stops nearest to each end, if one helps.
// Services that call at both stops connect them; times come from live data.
async function shuttleOption(from,to){
  const [a]=nearestNusStops(from,1), [b]=nearestNusStops(to,1);
  if(!a||!b||a.code===b.code) return null;
  const total=distanceM(from,to);
  if(total<500 || a.distance+b.distance>total*0.7) return null;
  try{
    const [atA,atB]=await Promise.all([loadShuttleArrivals(a.code),loadShuttleArrivals(b.code)]);
    const atBNames=new Set(atB.map(x=>x.service));
    const services=atA.filter(x=>atBNames.has(x.service));
    return services.length ? {from:a,to:b,services} : null;
  }catch{ return null; }
}

/* ---------- Venues ---------- */

let venueIndexPromise=null;

// NUSMods venue list + NUSMods room coordinates, merged into one index.
function loadVenueIndex(){
  if(venueIndexPromise) return venueIndexPromise;
  venueIndexPromise=(async()=>{
    const byCode=new Map();
    const [list,coords]=await Promise.allSettled([
      getJSON(`${NUSMODS_BASE}/semesters/${SEMESTER}/venues.json`),
      getJSON("https://raw.githubusercontent.com/nusmodifications/nusmods/master/website/api/optimiser/_constants/venues.json")
        .catch(()=>getJSON("https://api.github.com/repos/nusmodifications/nusmods/contents/website/api/optimiser/_constants/venues.json?ref=master")
          .then(p=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(String(p.content).replace(/\s/g,"")),c=>c.charCodeAt(0))))))
    ]);
    if(coords.status==="fulfilled" && coords.value && typeof coords.value==="object"){
      for(const [code,v] of Object.entries(coords.value)){
        const lat=Number(v?.location?.y), lng=Number(v?.location?.x);
        if(!Number.isFinite(lat)||!Number.isFinite(lng)) continue;
        byCode.set(normaliseCode(code),{type:"venue",code,name:v.roomName||code,lat,lng,floor:v.floor??null});
      }
    }
    if(list.status==="fulfilled"){
      const rows=Array.isArray(list.value)?list.value:Object.keys(list.value||{});
      for(const r of rows){
        const code=typeof r==="string"?r:(r.venue||r.code||r.name);
        if(code && !byCode.has(normaliseCode(code))) byCode.set(normaliseCode(code),{type:"venue",code,name:code,lat:null,lng:null});
      }
    }
    return [...byCode.values()];
  })().catch(err=>{ console.warn("Venue index unavailable",err); venueIndexPromise=null; return []; });
  return venueIndexPromise;
}

function scoreMatch(q,code,name){
  const c=normaliseCode(code), n=normaliseCode(name);
  if(c===q) return 100;
  if(c.startsWith(q)) return 80;
  if(n.startsWith(q)) return 70;
  if(n.includes(q)) return 55;
  if(c.includes(q)) return 40;
  return 0;
}

// Instant local search across NUS venues, NUS shuttle stops and public stops.
async function searchPlacesLocal(query,{limit=10,includeStops=true}={}){
  const q=normaliseCode(query);
  if(!q) return [];
  const results=[];
  if(includeStops){
    for(const s of NUS_STOPS){ const sc=scoreMatch(q,s.code,s.name); if(sc) results.push({...s,score:sc+5}); }
  }
  for(const v of await loadVenueIndex()){ const sc=scoreMatch(q,v.code,v.name); if(sc) results.push({...v,score:sc}); }
  if(includeStops && (q.length>=3)){
    for(const s of await loadPublicStops()){ const sc=scoreMatch(q,s.code,s.name); if(sc>=55) results.push({...s,score:sc-20}); }
  }
  return results.sort((a,b)=>b.score-a.score||String(a.code).localeCompare(String(b.code))).slice(0,limit);
}

// Anywhere in Singapore: OpenStreetMap Nominatim, then Photon.
async function searchPlacesExternal(query){
  const q=String(query||"").trim();
  if(!q) return [];
  try{
    const params=new URLSearchParams({q:/singapore/i.test(q)?q:`${q}, Singapore`,format:"jsonv2",limit:"8",countrycodes:"sg"});
    const data=await getJSON(`https://nominatim.openstreetmap.org/search?${params}`);
    const rows=data.map(x=>({type:"place",code:x.name||q,name:x.display_name,lat:+x.lat,lng:+x.lon}))
      .filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng));
    if(rows.length) return rows;
  }catch(e){ console.warn("Nominatim failed",e); }
  try{
    const data=await getJSON(`https://photon.komoot.io/api/?${new URLSearchParams({q:`${q}, Singapore`,limit:"8",lang:"en"})}`);
    return (data.features||[]).map(f=>{
      const [lng,lat]=f.geometry?.coordinates||[], p=f.properties||{};
      return {type:"place",code:p.name||q,name:[p.street,p.district,p.city].filter(Boolean).join(", ")||"Singapore",lat:+lat,lng:+lng};
    }).filter(x=>x.lat>1&&x.lat<2&&x.lng>103&&x.lng<104);
  }catch(e){ console.warn("Photon failed",e); return []; }
}

// Resolve a venue name (e.g. a lesson's "COM1-0210") to a map location.
async function resolveVenue(name){
  const q=normaliseCode(name);
  const venues=await loadVenueIndex();
  const exact=venues.find(v=>normaliseCode(v.code)===q && v.lat!=null);
  if(exact) return exact;
  const stop=NUS_STOPS.find(s=>normaliseCode(s.code)===q||normaliseCode(s.name)===q);
  if(stop) return stop;
  const local=(await searchPlacesLocal(name,{limit:3})).find(v=>v.lat!=null && v.score>=70);
  if(local) return local;
  const ext=await searchPlacesExternal(`${name}, National University of Singapore`);
  return ext[0] ? {...ext[0],code:name} : null;
}

function placeKindLabel(p){
  return {nus:"NUS shuttle stop",public:"Bus stop",venue:"NUS venue",place:"Place"}[p.type]||"Place";
}

/* ---------- Venue picker (forms) ---------- */
// Renders a search field that suggests NUS venues as you type and searches
// the wider map on Enter. Returns {get()} -> {venue, venueLat, venueLng, venueSource}.

function venuePicker(container,{value="",lat=null,lng=null,source="",placeholder="Search COM1, LT27, UTown…"}={}){
  let selected={venue:value,venueLat:lat,venueLng:lng,venueSource:source||(value?"Saved":"")};
  container.innerHTML=`
    <div class="picker">
      <input class="input picker-input" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search">
      <div class="picker-results"></div>
    </div>`;
  const input=container.querySelector(".picker-input"), box=container.querySelector(".picker-results");
  let timer=null;

  const show=rows=>{
    box.innerHTML=rows.map((r,i)=>`<button type="button" class="picker-row" data-i="${i}"><b>${esc(r.code)}</b><small>${esc(r.name!==r.code?r.name:placeKindLabel(r))}</small></button>`).join("")
      + (input.value.trim().length>=3?`<button type="button" class="picker-row picker-more"><b>Search the map for “${esc(input.value.trim())}”</b><small>Addresses, buildings, places outside NUS</small></button>`:"");
    $$(".picker-row[data-i]",box).forEach(b=>b.onclick=()=>choose(rows[+b.dataset.i]));
    box.querySelector(".picker-more")?.addEventListener("click",external);
  };
  const choose=r=>{
    selected={venue:r.code,venueLat:r.lat??null,venueLng:r.lng??null,venueSource:placeKindLabel(r)};
    input.value=r.code;
    box.innerHTML="";
  };
  const external=async()=>{
    box.innerHTML=`<div class="picker-status"><span class="spinner sm"></span>Searching…</div>`;
    const rows=await searchPlacesExternal(input.value);
    box.innerHTML="";
    if(rows.length) show(rows);
    else box.innerHTML=`<div class="picker-status">Nothing found. The text you typed will be saved as the venue.</div>`;
  };
  input.addEventListener("input",()=>{
    selected={venue:input.value.trim(),venueLat:null,venueLng:null,venueSource:"Typed"};
    clearTimeout(timer);
    if(!input.value.trim()){ box.innerHTML=""; return; }
    timer=setTimeout(async()=>show(await searchPlacesLocal(input.value,{limit:6,includeStops:false})),120);
  });
  input.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); external(); } });
  input.addEventListener("blur",()=>setTimeout(()=>{ if(!box.contains(document.activeElement)) box.innerHTML=""; },200));

  return {get:()=>({...selected,venue:input.value.trim()||selected.venue})};
}
