/** Tongpin V0.6.9 · pure, testable friendship-intersection models.
 * These are historical public records, not real-time location or route data.
 */
const between=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;

export function validLocation(record){
  const lon=Number(record?.longitude),lat=Number(record?.latitude);
  return record?.longitude!=null && record?.latitude!=null && between(lon,-180,180) && between(lat,-90,90)
    && record.coordinate_system==='GCJ-02';
}

/** GCJ-02 -> approximate WGS-84 for the public-domain map projection.
 * Amap coordinate values remain unchanged in Supabase; conversion is render-only.
 * The approximate mainland check prevents converting Japan/Korea markers.
 */
export function gcjToWgs84(longitude,latitude){
  const lon=Number(longitude),lat=Number(latitude);
  if(!between(lon,-180,180)||!between(lat,-90,90))return null;
  if(lon<73.5||lon>135.1||lat<17||lat>54.5||(lon>125&&lat<42)||(lon>123&&lat<33))return {longitude:lon,latitude:lat};
  const PI=Math.PI,a=6378245.0,ee=.006693421622965943;
  function latShift(x,y){let v=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
    v+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;
    v+=(20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3;
    return v+(160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3;
  }
  function lonShift(x,y){let v=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
    v+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;
    v+=(20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3;
    return v+(150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3;
  }
  const rad=lat*PI/180,sin=Math.sin(rad),magic=1-ee*sin*sin,sqrt=Math.sqrt(magic);
  const dLat=latShift(lon-105,lat-35)*180/(((a*(1-ee))/(magic*sqrt))*PI);
  const dLon=lonShift(lon-105,lat-35)*180/((a/sqrt)*Math.cos(rad)*PI);
  return {longitude:lon-dLon,latitude:lat-dLat};
}

export function mapPoint(record){
  if(!validLocation(record))return null;
  const geo=gcjToWgs84(record.longitude,record.latitude);
  return {x:(geo.longitude+180)/360*1000,y:(90-geo.latitude)/180*500,
    longitude:geo.longitude,latitude:geo.latitude};
}

function dateRange(record){
  const d=String(record?.visited_on||'');
  const p=record?.visit_date_precision;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!['year','month','day'].includes(p))return null;
  const [y,m,day]=d.split('-').map(Number);
  if(!between(y,1900,2100)||!between(m,1,12)||!between(day,1,31))return null;
  const start=p==='year'?`${d.slice(0,4)}-01-01`:p==='month'?`${d.slice(0,7)}-01`:d;
  const end=p==='year'?`${d.slice(0,4)}-12-31`:p==='month'?`${d.slice(0,7)}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`:d;
  return {start,end,precision:p};
}

/** Connect points ONLY when their recorded visit-time windows cannot overlap.
 * This avoids inventing a journey order from a pair of year-only dates.
 */
export function chronologicallyCertainSegments(rows){
  const dated=rows.map(r=>({...r,span:dateRange(r),point:mapPoint(r)}))
    .filter(r=>r.span&&r.point).sort((a,b)=>a.span.start.localeCompare(b.span.start)||a.span.end.localeCompare(b.span.end));
  const result=[];
  for(let i=1;i<dated.length;i++){
    const a=dated[i-1],b=dated[i];
    // A route sketch is only meaningful when we can infer an unambiguous order.
    if(a.span.end>=b.span.start)continue;
    if(Math.abs(a.point.x-b.point.x)>500)continue; // no dateline-spanning false route
    result.push({from:a.point,to:b.point,fromPlace:a.item_id,toPlace:b.item_id});
  }
  return result;
}

export function buildTravelCrossings(rows,myId,friendId){
  const valid=(Array.isArray(rows)?rows:[]).filter(r=>r && validLocation(r)
    && r.status!=='want' && r.visibility!=='private' && [myId,friendId].includes(r.traveler_id))
    .map(r=>({...r,point:mapPoint(r)}));
  const own=valid.filter(r=>r.traveler_id===myId),friend=valid.filter(r=>r.traveler_id===friendId);
  const mineById=new Map(own.map(r=>[r.item_id,r]));
  const friendById=new Map(friend.map(r=>[r.item_id,r]));
  const places=[];
  const seen=new Set();
  for(const r of valid){
    if(seen.has(r.item_id))continue;seen.add(r.item_id);
    const a=mineById.get(r.item_id)||null,b=friendById.get(r.item_id)||null;
    const pa=a?.point||b?.point;
    const datedA=a?dateRange(a):null,datedB=b?dateRange(b):null;
    const sameDay=Boolean(datedA&&datedB&&datedA.precision==='day'&&datedB.precision==='day'&&datedA.start===datedB.start);
    const sameYear=Boolean(datedA&&datedB&&datedA.start.slice(0,4)===datedB.start.slice(0,4));
    places.push({item_id:r.item_id,name:r.place_name,subtitle:r.place_subtitle,point:pa,mine:a,friend:b,
      shared:!!(a&&b),sameDay,sameYear});
  }
  const crossings=places.filter(p=>p.shared).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  return {own,friend,crossings,places,mySegments:chronologicallyCertainSegments(own),
    friendSegments:chronologicallyCertainSegments(friend)};
}

export function initialViewport(places){
  const pts=(places||[]).map(p=>p.point).filter(Boolean);
  if(!pts.length)return {x:0,y:0,w:1000,h:500};
  const minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x));
  const minY=Math.min(...pts.map(p=>p.y)),maxY=Math.max(...pts.map(p=>p.y));
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  // Deliberate minimum field of view: a single station still has geographic context.
  const w=Math.min(1000,Math.max(95,(maxX-minX)*1.65,(maxY-minY)*3.1));
  const h=w/2;
  return clampViewport({x:cx-w/2,y:cy-h/2,w,h});
}
export function clampViewport(v){
  const w=Math.min(1000,Math.max(27,Number(v.w)||1000)),h=w/2;
  return {w,h,x:Math.max(0,Math.min(1000-w,Number(v.x)||0)),y:Math.max(0,Math.min(500-h,Number(v.y)||0))};
}
export function zoomViewport(v,scale,anchorX=.5,anchorY=.5){
  const w=Math.max(27,Math.min(1000,v.w*scale)),h=w/2;
  return clampViewport({x:v.x+v.w*anchorX-w*anchorX,y:v.y+v.h*anchorY-h*anchorY,w,h});
}
