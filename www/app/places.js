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
// Every request gives up after `timeout` ms so the UI never waits forever.
async function getJSON(url,{native=false,timeout=12000,headers={}}={}){
  const http=window.Capacitor?.Plugins?.CapacitorHttp;
  if(native && isNativeApp() && http){
    const r=await http.get({url,headers:{Accept:"application/json",...headers},connectTimeout:timeout,readTimeout:timeout});
    if(r.status<200||r.status>=300) throw new Error(`Request failed (${r.status})`);
    return typeof r.data==="string" ? JSON.parse(r.data) : r.data;
  }
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{Accept:"application/json",...headers},cache:"no-store",signal:ctrl.signal});
    if(!r.ok) throw new Error(`Request failed (${r.status})`);
    return await r.json();
  }catch(err){
    throw err.name==="AbortError" ? new Error("The request took too long.") : err;
  }finally{ clearTimeout(timer); }
}

/* ---------- Live arrivals ---------- */

const NEXTBUS_SITE="https://bus.hewliyang.com";

// NUS shuttle arrivals from NUS NextBus (bus.hewliyang.com).
// Returns [{service, next, then}] where next/then are minutes or null.
async function loadShuttleArrivals(code){
  const data=await getJSON(`${NEXTBUS_SITE}/api/stop/${encodeURIComponent(code)}`,{native:true});
  const mins=v=>{ const n=parseInt(v,10); return Number.isFinite(n)?n:null; };
  // Each row gives two times. A service can be listed twice (e.g. two loops
  // calling here), so pool every time per service and keep the soonest three.
  const byService=new Map();
  for(const t of data?.etas?.timings||[]){
    const list=byService.get(t.name)||[];
    list.push(mins(t.arrivalTime),mins(t.nextArrivalTime));
    byService.set(t.name,list);
  }
  return [...byService].map(([service,list])=>etaRow(service,list,"nus")).sort(byNextArrival);
}

// Singapore public bus arrivals from arrivelah (BusRouter SG).
async function loadPublicArrivals(code){
  const data=await getJSON(`https://arrivelah2.busrouter.sg/?id=${encodeURIComponent(code)}`);
  // Each arrival also says what kind of bus it is (type: SD single deck,
  // DD double deck, BD bendy) and how full it is (load: SEA seats available,
  // SDA standing, LSD limited standing), from LTA DataMall.
  const arrival=x=>{
    if(!x) return null;
    const ms=Number(x.duration_ms), t=new Date(x.time||x.estimatedArrival||"").getTime();
    const m=Number.isFinite(ms) ? Math.max(0,Math.round(ms/60000))
      : Number.isFinite(t) ? Math.max(0,Math.round((t-Date.now())/60000)) : null;
    return m==null ? null : {m,type:x.type||"",load:x.load||""};
  };
  return (data?.services||[]).map(s=>etaRow(s.no,[arrival(s.next),arrival(s.next2||s.subsequent),arrival(s.next3)],"public")).sort(byNextArrival);
}

// {service, kind, times: up to 3 minutes-away values, buses: [{type, load}]
// for those times when known, next, then}. `list` holds minutes or
// {m, type, load}.
function etaRow(service,list,kind){
  const seen=new Set();
  const arrivals=list.map(x=>typeof x==="number"?{m:x}:x)
    .filter(x=>x&&x.m!=null&&!seen.has(x.m)&&seen.add(x.m))
    .sort((a,b)=>a.m-b.m).slice(0,3);
  const times=arrivals.map(x=>x.m);
  return {service,kind,times,buses:arrivals.map(({type="",load=""})=>({type,load})),next:times[0]??null,then:times[1]??null};
}

const BUS_TYPES={DD:"Double",SD:"Single",BD:"Bendy"};
const BUS_LOADS={SEA:"Seats available",SDA:"Standing",LSD:"Packed"};
function byNextArrival(a,b){ return (a.next??999)-(b.next??999); }

// One row per service with the next three buses side by side, like SingaBus:
// minutes away (coloured by how full the bus is) over its deck type.
function etaRowsHTML(rows){
  const hasLoad=rows.some(r=>r.buses?.some(b=>BUS_LOADS[b.load]));
  return `<div class="eta-list">${rows.map(r=>`
    <div class="eta-row">
      <span class="route-badge ${r.kind==="nus"?`nus r-${esc(String(r.service).replace(/[^A-Za-z0-9]/g,""))}`:"public"}">${esc(r.service)}</span>
      <span class="eta-cells">${[0,1,2].map(i=>{
        const m=r.times[i], b=r.buses?.[i]||{};
        if(m==null) return `<span class="eta-cell"></span>`;
        return `<span class="eta-cell ${BUS_LOADS[b.load]?`load-${esc(b.load)}`:""}" ${BUS_LOADS[b.load]?`title="${esc(BUS_LOADS[b.load])}"`:""}>
          <b>${m<=0?"Arr":m}</b><small>${esc(BUS_TYPES[b.type]||(i===0&&r.kind==="nus"?"min":""))}</small></span>`;
      }).join("")}</span>
    </div>`).join("")}
    <p class="eta-legend">Minutes away${hasLoad?` · <i class="load-SEA">●</i> seats <i class="load-SDA">●</i> standing <i class="load-LSD">●</i> packed`:""}</p>
  </div>`;
}

// Arrival board HTML for one stop. Shuttle boards fall back to an embedded
// NextBus page in browsers, where the shuttle API is blocked by CORS.
async function arrivalsHTML(stop,{embed=true}={}){
  const isNus=stop.type==="nus";
  try{
    const rows=isNus ? await loadShuttleArrivals(stop.code) : await loadPublicArrivals(stop.code);
    return rows.length ? etaRowsHTML(rows) : `<div class="empty-inline">No buses right now.</div>`;
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

// Stops near a position for the Today card: NUS shuttle stops and public bus
// stops together, nearest first. A shuttle stop that shares a pole with a
// public stop is one entry carrying both.
async function nearbyBusStops(pos,limit=3){
  const nus=nearestNusStops(pos,3).filter(s=>s.distance<800);
  const pub=(await loadPublicStops())
    .map(s=>({...s,distance:distanceM(pos,s)}))
    .filter(s=>s.distance<600 && !NUS_STOPS.some(n=>distanceM(n,s)<45))
    .sort((a,b)=>a.distance-b.distance).slice(0,3);
  return [...nus,...pub].sort((a,b)=>a.distance-b.distance).slice(0,limit);
}

// Every service at a stop, shuttles and public buses mixed, soonest first.
async function combinedArrivals(stop){
  const nusStop=stop.type==="nus"?stop:NUS_STOPS.find(n=>distanceM(n,stop)<45);
  const pubStop=stop.type==="public"?stop:await publicStopNear(stop);
  const rows=[]; let shuttleBlocked=false;
  await Promise.all([
    nusStop&&loadShuttleArrivals(nusStop.code).then(r=>rows.push(...r)).catch(()=>{ shuttleBlocked=true; }),
    pubStop&&loadPublicArrivals(pubStop.code).then(r=>rows.push(...r)).catch(()=>{})
  ]);
  return {rows:rows.filter(r=>r.next!=null).sort(byNextArrival),shuttleBlocked:shuttleBlocked&&!isNativeApp(),nusStop,pubStop};
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
// The map keeps lastPosition up to date while it's open, so a fix from the
// last two minutes is used straight away. Otherwise ask for one, accepting a
// cached reading, and fall back to anything from the last 10 minutes.
function getPosition({fresh=false}={}){
  const age=lastPosition?Date.now()-lastPosition.at:Infinity;
  if(age<(fresh?120000:300000)) return Promise.resolve(lastPosition);
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error("Location isn't available on this device."));
    navigator.geolocation.getCurrentPosition(p=>{
      lastPosition={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,at:Date.now()};
      resolve(lastPosition);
    },err=>{
      if(err.code!==1 && lastPosition && Date.now()-lastPosition.at<600000) return resolve(lastPosition);
      reject(new Error(err.code===1?"Location permission is off.":"Couldn't get your location."));
    },{enableHighAccuracy:true,timeout:6000,maximumAge:60000});
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
const SHUTTLE_COLORS={A1:"#ef4444",A2:"#f59e0b",D1:"#8b5cf6",D2:"#7c3aed",K:"#2563eb",P:"#0ea5e9",R1:"#ec4899",R2:"#db2777"};
function lineColor(leg){
  if(leg.mode==="WALK") return "#8b93a5";
  if(leg.mode==="SHUTTLE") return SHUTTLE_COLORS[leg.line]||"#ef4444";
  if(leg.mode==="BUS") return "#16a34a";
  return MRT_COLORS[leg.line] || "#748477"; // LRT and anything else
}

function transitLabel(leg){
  if(leg.mode==="SHUTTLE") return `NUS shuttle ${leg.line}`;
  if(leg.mode==="BUS") return `Bus ${leg.line}`;
  if(leg.mode==="SUBWAY"||leg.mode==="RAIL"||leg.mode==="METRO") return MRT_COLORS[leg.line]?`${leg.line} line`:`${leg.line} LRT`;
  return leg.line||leg.mode;
}

// Public transport (bus + MRT/LRT) from Transitous, a free community router
// that uses LTA's timetables. Returns up to 4 itineraries:
// {duration, start, end, transfers, walk (m), legs:[{mode, line, headsign,
//  from:{name,code,lat,lng}, to:{...}, start, end, stops, distance, path}]}
// Public transport routes: OneMap (Singapore Land Authority, LTA data) when
// its token is available (see push-server/refresh-onemap-token.mjs), else
// Transitous. Both return the same shape.
// Why the last search did or didn't use OneMap, shown under the routes.
let oneMapStatus="";
// Every route from both planners, merged: the same buses in the same order
// count once (keeping the earlier arrival). Sorting is up to the caller.
async function loadTransitRoutes(from,to){
  const [om,tr]=await Promise.all([
    loadOneMapRoutes(from,to).then(its=>{ oneMapStatus=its==null?oneMapStatus:its.length?"ok":"OneMap found no routes"; return its||[]; })
      .catch(err=>{ oneMapStatus=`OneMap error: ${err.message||err}`; console.warn("OneMap routing failed",err); return []; }),
    loadTransitousRoutes(from,to).catch(err=>{ console.warn("Transitous routing failed",err); return []; })
  ]);
  const byKey=new Map();
  for(const it of [...om,...tr]){
    const key=it.legs.filter(l=>l.mode!=="WALK").map(l=>`${l.line}@${l.from.code||l.from.name}`).join(">");
    const prev=byKey.get(key);
    if(!prev||it.end<prev.end) byKey.set(key,it);
  }
  return [...byKey.values()].sort((a,b)=>a.end-b.end);
}

let oneMapToken=null, oneMapTokenProblem="";
async function getOneMapToken(){
  if(oneMapToken && oneMapToken.expiresAt>Date.now()+60000) return oneMapToken.token;
  const uid=window.nusFirebase?.user?.uid;
  let doc=null;
  try{ doc=uid?await window.nusFirebase.readDoc(`users/${uid}/private/onemap`):null; oneMapTokenProblem=doc?"":"no OneMap token saved for this account yet"; }
  catch(err){ oneMapTokenProblem=`couldn't read the OneMap token (${err.code||err.message||err})`; }
  if(doc?.token && !(doc.expiresAt>Date.now()+60000)) oneMapTokenProblem="the OneMap token has expired";
  oneMapToken=doc?.token && doc.expiresAt>Date.now()+60000 ? doc : null;
  return oneMapToken?.token||null;
}

async function loadOneMapRoutes(from,to){
  const token=await getOneMapToken();
  if(!token){ oneMapStatus=oneMapTokenProblem||"OneMap isn't set up"; return null; }
  const now=new Date(), p2=n=>String(n).padStart(2,"0");
  // Plain commas and colons, as in OneMap's examples: the native HTTP layer
  // re-encodes the URL, so pre-encoded %2C / %3A would arrive mangled.
  const c=n=>(+n).toFixed(6);
  const params=[`start=${c(from.lat)},${c(from.lng)}`,`end=${c(to.lat)},${c(to.lng)}`,"routeType=pt","mode=TRANSIT",
    `date=${p2(now.getMonth()+1)}-${p2(now.getDate())}-${now.getFullYear()}`,`time=${p2(now.getHours())}:${p2(now.getMinutes())}:00`,
    "maxWalkDistance=1000"].join("&");
  // Ask for as many routes as OneMap gives; fall back to its documented 3.
  try{ return await oneMapRequest(`${params}&numItineraries=8`,token,from,to); }
  catch(err){ console.warn("OneMap with 8 routes failed, retrying with 3",err); }
  return oneMapRequest(`${params}&numItineraries=3`,token,from,to);
}

async function oneMapRequest(params,token,from,to){
  const url=`https://www.onemap.gov.sg/api/public/routingsvc/route?${params}`;
  // In the iOS app go native (no CORS); in browsers OneMap allows CORS.
  const http=window.Capacitor?.Plugins?.CapacitorHttp;
  let data;
  if(isNativeApp()&&http){
    const r=await http.get({url,headers:{Authorization:token},connectTimeout:12000,readTimeout:12000});
    if(r.status<200||r.status>=300) throw new Error(`OneMap ${r.status}${r.data?`: ${String(typeof r.data==="string"?r.data:JSON.stringify(r.data)).slice(0,120)}`:""}`);
    data=typeof r.data==="string"?JSON.parse(r.data):r.data;
  }else{
    const r=await fetch(url,{headers:{Authorization:token}});
    if(!r.ok) throw new Error(`OneMap ${r.status}: ${(await r.text().catch(()=>"")).slice(0,120)}`);
    data=await r.json();
  }
  const tidy=n=>String(n||"").replace(/\b([A-Z])([A-Z]+)\b/g,(m,a,b)=>a+b.toLowerCase());
  const place=p=>({name:p.name==="Origin"?"your location":p.name==="Destination"?"your destination":tidy(p.name),code:p.stopCode||"",lat:+p.lat,lng:+p.lon});
  const modeOf=m=>m==="SUBWAY"||m==="RAIL"?"SUBWAY":m;
  const seen=new Set();
  return (data?.plan?.itineraries||[]).map(it=>{
    const legs=(it.legs||[]).map(l=>({
      mode:modeOf(l.mode), line:String(l.route||l.routeShortName||""), headsign:tidy(l.headsign||""),
      from:place(l.from), to:place(l.to), start:new Date(l.startTime), end:new Date(l.endTime),
      stops:(l.intermediateStops||[]).length+1, distance:l.distance||0, duration:l.duration||((l.endTime-l.startTime)/1000),
      stopList:l.mode==="WALK"?[]:[l.from,...(l.intermediateStops||[]),l.to].map(p=>({name:tidy(p.name),lat:+p.lat,lng:+p.lon,time:p.arrival||p.departure||null})),
      path:l.legGeometry?.points?decodePolyline(l.legGeometry.points,5):[]
    }));
    return {duration:it.duration,start:new Date(it.startTime),end:new Date(it.endTime),transfers:it.transfers||0,
      walk:legs.filter(l=>l.mode==="WALK").reduce((n,l)=>n+l.distance,0),legs,source:"OneMap"};
  }).filter(it=>{
    if(!it.legs.some(l=>l.mode!=="WALK")) return false;
    const key=it.legs.filter(l=>l.mode!=="WALK").map(l=>l.line).join(">");
    if(seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a.end-b.end);
}

async function loadTransitousRoutes(from,to){
  const params=new URLSearchParams({fromPlace:`${from.lat},${from.lng}`,toPlace:`${to.lat},${to.lng}`,time:new Date().toISOString(),numItineraries:"8"});
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
      stopList:l.mode==="WALK"?[]:[l.from,...(l.intermediateStops||[]),l.to].map(p=>({name:tidy(p.name),lat:p.lat,lng:p.lon,time:Date.parse(p.arrival||p.departure||"")||null})),
      path:l.legGeometry?.points?decodePolyline(l.legGeometry.points,l.legGeometry.precision||6):[]
    }));
    return {duration:it.duration,start:new Date(it.startTime),end:new Date(it.endTime),transfers:it.transfers,source:"Transitous",
      walk:legs.filter(l=>l.mode==="WALK").reduce((n,l)=>n+l.distance,0),legs};
  }).filter(it=>{
    if(!it.legs.some(l=>l.mode!=="WALK")) return false;
    const key=it.legs.filter(l=>l.mode!=="WALK").map(l=>l.line).join(">");
    if(seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a.end-b.end);
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

/* ---------- NUS shuttle trips ---------- */

// Stop order for each NUS shuttle service (from NUS NextBus). Routes that
// start and end at the same stop are loops.
const SHUTTLE_ROUTES={
  A1:["KRB","LT13","AS5","BIZ2","TCOMS-OPP","PGP","KR-MRT","LT27","UHALL","UHC-OPP","YIH","CLB","KRB"],
  A2:["KRB","IT","YIH-OPP","MUSEUM","UHC","UHALL-OPP","S17","KR-MRT-OPP","PGPR","TCOMS","HSSML-OPP","NUSS-OPP","LT13-OPP","KRB"],
  D1:["COM3","HSSML-OPP","NUSS-OPP","LT13-OPP","IT","YIH-OPP","MUSEUM","UTOWN","YIH","CLB","LT13","AS5","BIZ2","COM3"],
  D2:["COM3","TCOMS-OPP","PGP","KR-MRT","LT27","UHALL","UHC-OPP","MUSEUM","UTOWN","UHC","UHALL-OPP","S17","KR-MRT-OPP","PGPR","TCOMS","COM3"],
  K:["PGP","KR-MRT","LT27","UHALL","UHC-OPP","YIH","CLB","SDE3-OPP","JP-SCH-16151","KV","MUSEUM","UHC","UHALL-OPP","S17","KR-MRT-OPP","PGPR"],
  P:["KV","CG","OTH","BG-MRT","KR-MRT","UHC-OPP","UTOWN","KV"],
  R1:["KV","MUSEUM","UTOWN","YIH","CLB","LT13","AS5","BIZ2","PGP"],
  R2:["PGP","HSSML-OPP","NUSS-OPP","LT13-OPP","IT","YIH-OPP","UTOWN","RAFFLES","KV"]
};

// Shortest ride from stop a to stop b on each service, in travel direction.
function shuttleRides(a,b){
  const rides=[];
  for(const [service,route] of Object.entries(SHUTTLE_ROUTES)){
    const loop=route[0]===route[route.length-1];
    const seq=loop?route.concat(route.slice(1)):route;
    let best=null;
    route.forEach((code,i)=>{
      if(code!==a || (loop && i===route.length-1)) return;
      const j=seq.indexOf(b,i+1);
      if(j>i && (!best || j-i<best.length-1)) best=seq.slice(i,j+1);
    });
    if(best) rides.push({service,stops:best});
  }
  return rides;
}

const WALK_SPEED=1.25;   // m/s, allowing for paths not being straight
const SECONDS_PER_STOP=100;

// NUS shuttle journeys from `from` to `to`, built from live arrivals, in the
// same shape as loadTransitRoutes() so both list and draw the same way.
async function planShuttleTrips(from,to){
  if(distanceM(from,to)<400) return [];
  const near=p=>NUS_STOPS.map(s=>({...s,distance:distanceM(p,s)})).filter(s=>s.distance<=700).sort((x,y)=>x.distance-y.distance).slice(0,4);
  const origins=near(from), dests=near(to);
  const options=[];
  for(const a of origins) for(const b of dests){
    if(a.code===b.code) continue;
    for(const ride of shuttleRides(a.code,b.code)){
      options.push({a,b,ride,score:a.distance/WALK_SPEED+(ride.stops.length-1)*SECONDS_PER_STOP+b.distance/WALK_SPEED});
    }
  }
  // Best option per service.
  const best=new Map();
  for(const o of options.sort((x,y)=>x.score-y.score)) if(!best.has(o.ride.service)) best.set(o.ride.service,o);
  const picked=[...best.values()].slice(0,8);
  if(!picked.length) return [];

  const live=new Map();
  await Promise.all([...new Set(picked.map(o=>o.a.code))].map(async code=>{
    try{ live.set(code,await loadShuttleArrivals(code)); }catch{ live.set(code,[]); }
  }));

  const now=Date.now(), stopName=c=>NUS_STOPS.find(s=>s.code===c)?.name||c;
  const trips=[];
  for(const {a,b,ride} of picked){
    const eta=(live.get(a.code)||[]).find(x=>x.service===ride.service);
    if(!eta || eta.next==null) continue; // not running right now
    const walk1=a.distance/WALK_SPEED, walk2=b.distance/WALK_SPEED;
    // Catch the first bus you can reach on foot.
    const catchable=eta.times.filter(m=>m*60>=walk1-30);
    const waitMin=catchable.length?catchable[0]:null;
    if(waitMin==null) continue;
    const board=now+Math.max(walk1,waitMin*60)*1000;
    const rideSecs=(ride.stops.length-1)*SECONDS_PER_STOP;
    const alight=board+rideSecs*1000;
    const end=alight+walk2*1000;
    const stopsPath=ride.stops.map(c=>{ const s=NUS_STOPS.find(x=>x.code===c); return [s.lat,s.lng]; });
    trips.push({
      shuttle:true, duration:(end-now)/1000, start:new Date(now), end:new Date(end), transfers:0, walk:a.distance+b.distance,
      live:{service:ride.service,stop:a.code,next:waitMin,times:eta.times},
      legs:[
        {mode:"WALK",line:"",from:{name:"your location",lat:from.lat,lng:from.lng},to:{name:a.name,code:a.code,lat:a.lat,lng:a.lng},
          start:new Date(now),end:new Date(now+walk1*1000),distance:a.distance,duration:walk1,path:[[from.lat,from.lng],[a.lat,a.lng]],needsPath:"walk"},
        {mode:"SHUTTLE",line:ride.service,headsign:(r=>r[0]===r.at(-1)?"":stopName(r.at(-1)))(SHUTTLE_ROUTES[ride.service]),
          from:{name:a.name,code:a.code,lat:a.lat,lng:a.lng},to:{name:b.name,code:b.code,lat:b.lat,lng:b.lng},
          start:new Date(board),end:new Date(alight),stops:ride.stops.length-1,distance:0,duration:rideSecs,path:stopsPath,needsPath:"shuttle",
          via:ride.stops.slice(1,-1).map(stopName),
          stopList:ride.stops.map(c=>{ const s=NUS_STOPS.find(x=>x.code===c); return {name:s.name,lat:s.lat,lng:s.lng,time:null}; })},
        {mode:"WALK",line:"",from:{name:b.name,lat:b.lat,lng:b.lng},to:{name:"your destination",lat:to.lat,lng:to.lng},
          start:new Date(alight),end:new Date(end),distance:b.distance,duration:walk2,path:[[b.lat,b.lng],[to.lat,to.lng]],needsPath:"walk"}
      ]
    });
  }
  return trips.sort((x,y)=>x.end-y.end);
}

// Replace a shuttle trip leg's straight-line preview with a road-following
// path. Each leg is tried once; on failure the straight line stays.
async function loadLegPath(leg){
  const kind=leg.needsPath;
  if(!kind) return leg.path;
  leg.needsPath=null;
  try{
    if(kind==="walk"){
      if(leg.distance<25) return leg.path;
      const r=await loadStreetRoute("walk",{lat:leg.path[0][0],lng:leg.path[0][1]},{lat:leg.path.at(-1)[0],lng:leg.path.at(-1)[1]});
      leg.path=r.path; leg.distance=r.distance;
    }else{
      const coords=leg.path.map(([lat,lng])=>`${lng},${lat}`).join(";");
      const data=await getJSON(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      if(data?.routes?.[0]) leg.path=data.routes[0].geometry.coordinates.map(([lng,lat])=>[lat,lng]);
    }
  }catch(err){ console.warn("Route shape unavailable",err); }
  return leg.path;
}

/* ---------- Venues ---------- */

let venueIndexPromise=null;

// NUSMods venue list + NUSMods room coordinates, merged into one index.
function loadVenueIndex(){
  if(venueIndexPromise) return venueIndexPromise;
  venueIndexPromise=(async()=>{
    const byCode=new Map();
    const [list,coords]=await Promise.allSettled([
      getJSON(`${nusmodsBase()}/semesters/${currentSemesterNo()}/venues.json`),
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
  for(const p of state.places||[]){
    const sc=scoreMatch(q,p.name,p.address||"");
    if(sc) results.push({type:"saved",...p,code:p.name,name:p.address||"Saved place",score:sc+20});
  }
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

// Places matching `query` around the visible map, nearest to `center` first,
// like Google Maps: search the view, then a wider area, then all of Singapore
// until there are enough results. Apple Maps in the iOS app, OpenStreetMap
// on the web, both topped up with OneMap.
const KIND_LABELS={fast_food:"Fast food",restaurant:"Restaurant",cafe:"Café",food_court:"Food court",bar:"Bar",
  supermarket:"Supermarket",convenience:"Convenience store",mall:"Shopping mall",bank:"Bank",atm:"ATM",
  pharmacy:"Pharmacy",clinic:"Clinic",hospital:"Hospital",station:"Station",subway_entrance:"MRT entrance",
  bus_stop:"Bus stop",school:"School",university:"University",library:"Library",gym:"Gym",fitness_centre:"Gym",
  park:"Park",hotel:"Hotel",cinema:"Cinema",parking:"Car park",post_office:"Post office",bakery:"Bakery"};

const areaSearchCache=new Map();
let lastNominatimAt=0;

// In the iOS app, Apple Maps search (PlaceSearchPlugin.swift): real business
// listings with typo-tolerant matching, biased to the visible map.
const applePlaceSearch=isNativeApp()?window.Capacitor?.Plugins?.PlaceSearch||null:null;

async function searchPlacesApple(q,bounds,center,min){
  const region=f=>({lat:(bounds.n+bounds.s)/2,lng:(bounds.e+bounds.w)/2,latDelta:(bounds.n-bounds.s)*f,lngDelta:(bounds.e-bounds.w)*f});
  const seen=new Set(), out=[];
  const add=places=>{
    for(const x of places||[]){
      const key=`${String(x.name).toLowerCase()}|${Math.round(x.lat*2000)}|${Math.round(x.lng*2000)}`;
      if(seen.has(key)) continue;
      seen.add(key);
      out.push({type:"place",code:x.name,name:[x.address,/^\d+$/.test(x.area)?"":x.area].filter(Boolean).join(", ")||x.postcode||"Singapore",
        kind:x.category||"",lat:x.lat,lng:x.lng,phone:x.phone||"",url:x.url||"",distance:distanceM(center,{lat:x.lat,lng:x.lng})});
    }
  };
  // The view first; if that's thin, a wider area, like "search this area".
  add((await applePlaceSearch.search({query:q,...region(1)})).places);
  if(out.length<min) add((await applePlaceSearch.search({query:q,...region(6)})).places);
  return out.sort((a,b)=>a.distance-b.distance);
}

// OneMap's search is Singapore's official address list: every HDB block,
// condo, building and postal code. Apple Maps and OpenStreetMap sometimes
// miss these or swap in a similar name ("Clementi Peaks" -> "Clementi Park").
const ONEMAP_CAPS=new Set(["NUS","NTU","SMU","SUTD","SIT","SUSS","MRT","LRT","HDB","CC","RC","ITE","JC","SAF","MOE","NUH","SGH","TTSH","KKH","CBD","MSCP","PCN","UOB","OCBC","DBS","II","III","IV"]);
function oneMapTitle(s){
  return String(s||"").toLowerCase().replace(/[a-z0-9'&.]+/g,w=>{
    const up=w.toUpperCase();
    return ONEMAP_CAPS.has(up)||/\d/.test(w)?up:w[0].toUpperCase()+w.slice(1);
  });
}

// Without a token OneMap allows about one search a second, so searches are
// spaced out and repeats come from a cache.
const oneMapSearchCache=new Map();
let lastOneMapSearchAt=0;

async function searchPlacesOneMap(q,center){
  const key=q.toLowerCase();
  if(!oneMapSearchCache.has(key)){
    const token=await getOneMapToken().catch(()=>null);
    const wait=(token?250:1100)-(Date.now()-lastOneMapSearchAt);
    if(wait>0) await new Promise(r=>setTimeout(r,wait));
    lastOneMapSearchAt=Date.now();
    const params=new URLSearchParams({searchVal:q,returnGeom:"Y",getAddrDetails:"Y",pageNum:"1"});
    const data=await getJSON(`https://www.onemap.gov.sg/api/common/elastic/search?${params}`,
      {timeout:8000,native:true,headers:token?{Authorization:token}:{}});
    oneMapSearchCache.set(key,data.results||[]);
  }
  return oneMapSearchCache.get(key).map(x=>{
    const lat=+x.LATITUDE, lng=+x.LONGITUDE;
    const building=x.BUILDING&&x.BUILDING!=="NIL"?x.BUILDING:"";
    const blk=x.BLK_NO&&x.BLK_NO!=="NIL"?x.BLK_NO:"";
    const street=oneMapTitle([blk&&building?`Block ${blk}`:blk,x.ROAD_NAME].filter(Boolean).join(" "));
    const postal=x.POSTAL&&x.POSTAL!=="NIL"?`Singapore ${x.POSTAL}`:"";
    return {type:"place",code:building?oneMapTitle(building):street||oneMapTitle(x.SEARCHVAL),
      name:[building?street:"",postal].filter(Boolean).join(", ")||"Singapore",
      kind:"",lat,lng,distance:distanceM(center,{lat,lng})};
  }).filter(p=>p.lat>1&&p.lat<2&&p.lng>103&&p.lng<105);
}

// Places whose name has every word typed come first (nearest first), then
// the rest; the same place from two sources is shown once.
function mergePlaceResults(q,lists){
  const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9 ]/g," ");
  const words=norm(q).split(/\s+/).filter(Boolean);
  const out=[];
  for(const p of lists.flat()){
    if(out.some(o=>norm(o.code).trim()===norm(p.code).trim()&&distanceM(o,p)<80)) continue;
    out.push(p);
  }
  const named=p=>words.every(w=>norm(`${p.code} ${p.name}`).includes(w))?0:1;
  return out.sort((a,b)=>named(a)-named(b)||a.distance-b.distance);
}

// `onPartial` gets OneMap's results early when the other source is slower.
async function searchPlacesInArea(query,bounds,center,{min=8,onPartial=null}={}){
  const q=String(query||"").trim();
  if(q.length<2) return [];
  let done=false;
  const official=q.length>=3?searchPlacesOneMap(q,center).catch(err=>{ console.warn("OneMap search failed",err); return []; }):Promise.resolve([]);
  official.then(rows=>{ if(!done&&rows.length) onPartial?.(mergePlaceResults(q,[rows])); });
  let rows=null;
  if(applePlaceSearch){
    try{ rows=await searchPlacesApple(q,bounds,center,min); }
    catch(err){ console.warn("Apple Maps search failed",err); }
  }
  if(!rows) rows=await searchPlacesOSM(q,bounds,center,{min});
  const merged=mergePlaceResults(q,[rows,await official]);
  done=true;
  return merged;
}

// OpenStreetMap (Nominatim) search, for browsers.
async function searchPlacesOSM(q,bounds,center,{min=8}={}){
  // Nominatim asks for at most one request a second.
  const run=async(viewbox,bounded)=>{
    const key=`${q.toLowerCase()}|${viewbox}|${bounded}`;
    if(areaSearchCache.has(key)) return areaSearchCache.get(key);
    const wait=1100-(Date.now()-lastNominatimAt);
    if(wait>0) await new Promise(r=>setTimeout(r,wait));
    lastNominatimAt=Date.now();
    const params=new URLSearchParams({q,format:"jsonv2",limit:"40",addressdetails:"1",countrycodes:"sg",viewbox,bounded:bounded?"1":"0"});
    const data=await getJSON(`https://nominatim.openstreetmap.org/search?${params}`,{timeout:10000});
    areaSearchCache.set(key,data);
    return data;
  };
  const box=(b,f)=>{
    const cLat=(b.n+b.s)/2, cLng=(b.e+b.w)/2, hLat=(b.n-b.s)/2*f, hLng=(b.e-b.w)/2*f;
    return `${(cLng-hLng).toFixed(5)},${(cLat+hLat).toFixed(5)},${(cLng+hLng).toFixed(5)},${(cLat-hLat).toFixed(5)}`;
  };
  const seen=new Set(), out=[];
  const add=rows=>{
    for(const x of rows||[]){
      const lat=+x.lat, lng=+x.lon;
      if(!Number.isFinite(lat)||!Number.isFinite(lng)) continue;
      const a=x.address||{};
      const name=x.name||a[x.type]||q;
      const street=[a.house_number,a.road].filter(Boolean).join(" ");
      const area=a.suburb||a.neighbourhood||a.quarter||a.city_district||"";
      // One entry per place: the same outlet can appear as a node and a building.
      const key=`${name.toLowerCase()}|${Math.round(lat*2000)}|${Math.round(lng*2000)}`;
      if(seen.has(key)) continue;
      seen.add(key);
      out.push({type:"place",osmType:x.type,code:name,name:[street,area].filter(Boolean).join(", ")||x.display_name,
        kind:KIND_LABELS[x.type]||"",lat,lng,distance:distanceM(center,{lat,lng})});
    }
  };
  // Keep places whose name contains every word searched for ("mcdonald"
  // matches "McDonald's"), and leave out their car parks unless asked for.
  const words=q.toLowerCase().replace(/[^a-z0-9 ]/g,"").split(/\s+/).filter(Boolean);
  const wantsParking=/park/i.test(q);
  const matches=()=>out.filter(p=>{
    const n=p.code.toLowerCase().replace(/[^a-z0-9 ]/g,"");
    return words.every(w=>n.includes(w)) && (wantsParking || !(p.osmType==="parking"||/parking/i.test(p.code)));
  });
  // Nominatim only returns many results for a bounded box, so widen in steps
  // and finish with the whole of Singapore.
  try{
    for(const f of [1.2,4,12]){
      add(await run(box(bounds,f),true));
      if(matches().length>=min) break;
    }
    if(matches().length<min) add(await run("103.59,1.48,104.10,1.20",true));
  }catch(err){ console.warn("Area search failed",err); }
  // Addresses and areas don't contain the words; fall back to everything.
  const named=matches();
  return (named.length?named:out).sort((a,b)=>a.distance-b.distance);
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
  return {nus:"NUS shuttle stop",public:"Bus stop",venue:"NUS venue",place:"Place",saved:"Saved place"}[p.type]||"Place";
}

// Icons for saved places.
const PLACE_ICONS={
  home:{label:"Home",path:"M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"},
  work:{label:"Work",path:"M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"},
  food:{label:"Food",path:"M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9"},
  star:{label:"Favourite",path:"M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"}
};

// Street address for a point (OpenStreetMap), for dropped pins.
async function reverseGeocode(lat,lng){
  try{
    const d=await getJSON(`https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({lat,lon:lng,format:"jsonv2",zoom:"18"})}`,{timeout:6000});
    const a=d.address||{};
    const line=[a.house_number&&a.road?`${a.house_number} ${a.road}`:a.road,a.building||a.amenity,a.suburb||a.neighbourhood].filter(Boolean);
    return {title:d.name||line[0]||"Dropped pin",address:[...new Set(line)].join(", ")||d.display_name||""};
  }catch{ return {title:"Dropped pin",address:`${lat.toFixed(5)}, ${lng.toFixed(5)}`}; }
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
