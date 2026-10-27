/**
 * Same-origin /api/search on Vercel. Do not prefix IGDB/Twitch/Amap secrets with VITE_.
 * This function does not proxy Supabase data; the existing browser SDK still uses RLS.
 */
import {validateSearch,searchCatalog,validatePage} from '../server/search.mjs';
import {verifySupabaseUser} from '../server/auth.mjs';

// Best-effort warm-instance rate limiting; configure Vercel Firewall rate limiting for production.
const requests=new Map();
function allowed(id){
  const now=Date.now(),old=requests.get(id);
  const current=old&&now-old.window<60_000?old:{window:now,count:0};
  current.count++; requests.set(id,current);
  if(requests.size>500){for(const [key,v] of requests){if(now-v.window>=60_000)requests.delete(key)}}
  return current.count<=30;
}
function send(res,status,data){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(data);
}
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{error:'仅支持 GET 请求'})}
  try{
    const url=new URL(req.url||'/api/search','https://localhost');
    const category=url.searchParams.get('category');
    const query=validateSearch(category,url.searchParams.get('q'));
    const page=validatePage(url.searchParams.get('page')||1);
    const token=(/^Bearer (.+)$/i.exec(req.headers.authorization||'')||[])[1];
    const userId=await verifySupabaseUser(token);
    if(!allowed(userId))return send(res,429,{error:'搜索过于频繁，请稍后再试'});
    const result=await searchCatalog(category,query,{page});
    return send(res,200,result);
  }catch(error){
    const status=[400,401,403,429,503].includes(error.status)?error.status:502;
    return send(res,status,{error:String(error.message||'搜索暂不可用').slice(0,180)});
  }
}
