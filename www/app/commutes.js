/* Saved commutes: a route you trust (for example the one Citymapper gives
 * you), saved from Directions and reused with live times.
 *   state.commutes: [{id, name, to:{name,lat,lng}, legs:[{mode, line, headsign,
 *     from:{name,code,lat,lng}, to:{...}, stops, duration, distance, path}], savedAt}]
 * The legs keep which buses and stops to use, not clock times; every time
 * you open a commute it is re-timed from live arrivals.
 */

const RIDE_MODES=new Set(["BUS","SHUTTLE","SUBWAY","RAIL","TRAM","MONORAIL"]);
const isRide=l=>RIDE_MODES.has(l.mode);

function commuteFromItinerary(it,{name,to}){
  const r5=n=>Math.round(n*1e5)/1e5;
  const pt=p=>({name:p.name==="your destination"?to.name:p.name,code:p.code||"",lat:r5(p.lat),lng:r5(p.lng)});
  return {id:uid(),name,savedAt:Date.now(),to:{name:to.name,lat:r5(to.lat),lng:r5(to.lng)},
    legs:it.legs.filter(l=>isRide(l)||l.distance>=20).map(l=>{
      // Long paths are thinned so the commute stays small when synced.
      const step=Math.max(1,Math.ceil((l.path||[]).length/250));
      return {mode:l.mode,line:l.line||"",headsign:l.headsign||"",from:pt(l.from),to:pt(l.to),
        stops:l.stops||0,duration:l.duration||0,distance:l.distance||0,
        path:(l.path||[]).filter((_,i,a)=>i%step===0||i===a.length-1).map(([a,b])=>[r5(a),r5(b)])};
    })};
}

// Minutes-away for `line` at a leg's boarding stop, or null when there's no live feed.
async function legLiveTimes(l){
  if(!l.from.code||(l.mode!=="BUS"&&l.mode!=="SHUTTLE")) return null;
  const rows=l.mode==="SHUTTLE"?await loadShuttleArrivals(l.from.code):await loadPublicArrivals(l.from.code);
  return rows.find(r=>String(r.service)===String(l.line))?.times||[];
}

// Re-times a commute from where you are: the walk to the first stop, the
// first bus you can still catch, and when you'd arrive.
async function commuteLive(c,pos){
  const i=c.legs.findIndex(isRide);
  if(i<0) return {first:null};
  const first=c.legs[i];
  const walkBefore=c.legs.slice(0,i).reduce((n,l)=>n+(l.duration||0),0);
  const walkSec=pos?Math.round(distanceM(pos,first.from)*1.3/WALK_SPEED):walkBefore;
  let times=null;
  try{ times=await legLiveTimes(first); }catch{}
  const catchable=(times||[]).filter(m=>m*60>=walkSec-30);
  const rest=c.legs.slice(i).reduce((n,l)=>n+(l.duration||0),0);
  const boardIn=catchable.length?catchable[0]*60:walkSec;
  return {first,walkMin:Math.max(0,Math.round(walkSec/60)),times,catchable,
    leaveIn:catchable.length?Math.max(0,Math.round((catchable[0]*60-walkSec)/60)):0,
    arrive:new Date(Date.now()+(boardIn+rest)*1000)};
}

function commuteSummaryHTML(live){
  if(!live.first) return "Walk";
  const f=live.first;
  if(live.times==null) return `${transitLabel(f)} from ${f.from.name} · arrive ~${clockTime(live.arrive)}`;
  if(!live.catchable.length) return `No ${f.line} you can catch right now`;
  const m=live.catchable[0];
  return `${f.line} ${m<=0?"arriving":`in ${m} min`} · ${live.leaveIn<=0?"leave now":`leave in ${live.leaveIn} min`} · arrive ~${clockTime(live.arrive)}`;
}

function commuteChipsHTML(){
  return (state.commutes||[]).map(c=>`<button class="chip solid commute-chip" data-commute="${esc(c.id)}">${icon("M3 12h13M12 5l7 7-7 7",14)}${esc(c.name)}</button>`).join("");
}

// Today: one line per commute with live timing.
function commutesCardHTML(){
  if(!(state.commutes||[]).length) return "";
  return `<div class="card commute-card"><div class="card-head"><h3>Commutes</h3><button class="link" data-go="map">Map</button></div>
    ${state.commutes.map(c=>`<button class="commute-row" data-go="map" data-params='${esc(JSON.stringify({commute:c.id}))}'>
      <span class="commute-legs">${c.legs.filter(isRide).map(l=>`<span class="leg-chip" style="--c:${lineColor(l)}">${esc(l.line||transitLabel(l))}</span>`).join("")}</span>
      <span class="commute-main"><b>${esc(c.name)}</b><small data-commute-live="${esc(c.id)}"><span class="spinner sm"></span></small></span>
      ${icon("M9 18l6-6-6-6",18)}</button>`).join("")}</div>`;
}

async function fillCommuteCard(el){
  let pos=null;
  try{ pos=await getPosition(); }catch{}
  for(const c of state.commutes||[]){
    const slot=$(`[data-commute-live="${CSS.escape(c.id)}"]`,el);
    if(!slot) continue;
    try{ slot.textContent=commuteSummaryHTML(await commuteLive(c,pos)); }
    catch{ slot.textContent="Live times unavailable"; }
  }
}

/* ---------- The trip in progress (iOS app) ---------- */
// Saved on this device when a trip starts, so it can be reopened from the
// Map, Today or the Dynamic Island after closing the route.
//   {kind:"transit", name, commute:{...commute shape}, startedAt}
//   {kind:"street", mode, dest:{type,code,name,lat,lng}, startedAt}
function loadActiveTrip(){ try{ return JSON.parse(localStorage.getItem("nus_active_trip")||"null"); }catch{ return null; } }
function saveActiveTrip(t){ try{ localStorage.setItem("nus_active_trip",JSON.stringify({...t,startedAt:Date.now()})); }catch{} window.dispatchEvent(new CustomEvent("nus-trip-changed")); }
function clearActiveTrip(){ try{ localStorage.removeItem("nus_active_trip"); }catch{} window.dispatchEvent(new CustomEvent("nus-trip-changed")); }
function activeTripName(t){ return t?.kind==="transit"?t.name:t?.dest?.code||t?.dest?.name||"your destination"; }

// "Trip in progress" bar for Today.
function tripBannerHTML(){
  const t=loadActiveTrip();
  if(!t) return "";
  return `<button class="banner trip-banner" data-go="map" data-params='{"trip":"1"}'>${icon("M3 11l19-9-9 19-2-8-8-2z",18)}<span><b>Trip in progress</b> · to ${esc(activeTripName(t))}</span>${icon("M9 18l6-6-6-6",18)}</button>`;
}
