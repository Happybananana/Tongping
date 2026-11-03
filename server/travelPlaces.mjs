/** V0.6.8: standalone, testable Amap POI location normalizer.
 * Coordinates are Amap GCJ-02, not GPS/WGS-84. Never treat them as live location.
 */
export function parseAmapLocation(input){
  const text=typeof input==='string'?input.trim():'';
  const match=/^(-?\d{1,3}(?:\.\d{1,8})?),(-?\d{1,2}(?:\.\d{1,8})?)$/.exec(text);
  if(!match)return null;
  const lon=Number(match[1]),lat=Number(match[2]);
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon < -180||lon > 180||lat < -90||lat > 90)return null;
  return {longitude:Number(lon.toFixed(6)),latitude:Number(lat.toFixed(6))};
}
const word=(s,n)=>String(Array.isArray(s)?s[0]||'':s??'').slice(0,n).trim();
export function normalizeTravelPois(payload){
  return (Array.isArray(payload?.pois)?payload.pois:[]).filter(p=>p?.id&&p?.name).slice(0,15).map(p=>({
    id:word(p.id,80),name:word(p.name,100),subtitle:[p.pname,p.cityname,p.adname].map(x=>word(x,40)).filter(Boolean).join(' · ').slice(0,120),
    provider:'amap',providerItemId:word(p.id,80),location:parseAmapLocation(p.location),coordinateSystem:'GCJ-02'
  })).filter(p=>p.id&&p.name);
}
