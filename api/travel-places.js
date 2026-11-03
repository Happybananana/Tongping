/** V0.6.8 — authenticated place search that preserves Amap GCJ-02 coordinates.
 * The Web Service API key stays in server-side process.env.AMAP_WEB_KEY.
 */
import {verifySupabaseUser} from '../server/auth.mjs';
import {normalizeTravelPois} from '../server/travelPlaces.mjs';
const counters=new Map();
function allowed(id){
  const now=Date.now(),old=counters.get(id),value=old&&now-old.start<60000?old:{start:now,n:0};
  value.n++;counters.set(id,value);
  if(counters.size>300)for(const [k,v] of counters){if(now-v.start>60000)counters.delete(k)}
  return value.n<=25;
}
function send(res,status,body){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(status).json(body)}
export default async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{error:'仅支持 GET'});
  try{
    const url=new URL(req.url||'/api/travel-places','https://localhost');
    const query=String(url.searchParams.get('q')||'').trim();
    const page=Number(url.searchParams.get('page')||1);
    if(query.length<2||query.length>65||!Number.isSafeInteger(page)||page<1||page>10)return send(res,400,{error:'搜索关键词或页码无效'});
    const token=(/^Bearer (.+)$/i.exec(req.headers.authorization||'')||[])[1];
    const userId=await verifySupabaseUser(token);
    if(!allowed(userId))return send(res,429,{error:'搜索过于频繁，请稍后再试'});
    const key=process.env.AMAP_WEB_KEY;
    if(!key)return send(res,503,{error:'高德 Web 服务尚未配置'});
    const target=new URL('https://restapi.amap.com/v5/place/text');
    target.searchParams.set('key',key);target.searchParams.set('keywords',query);
    target.searchParams.set('page_size','15');target.searchParams.set('page_num',String(page));
    const upstream=await fetch(target,{signal:AbortSignal.timeout(7500)});
    if(!upstream.ok)throw Error('高德服务暂时不可用');
    const payload=await upstream.json();
    if(String(payload.status)!=='1')throw Error('高德地点查询失败：'+String(payload.info||'未知错误').slice(0,60));
    return send(res,200,{items:normalizeTravelPois(payload),hasMore:Array.isArray(payload.pois)&&payload.pois.length>=15});
  }catch(error){
    const status=[400,401,403,429].includes(error?.status)?error.status:502;
    return send(res,status,{error:String(error?.message||'地点搜索暂不可用').slice(0,120)});
  }
}
