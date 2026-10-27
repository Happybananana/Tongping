/** Vercel Function: authenticated Bangumi detail lookup (one item on demand). */
import {bangumiDetail} from '../server/search.mjs';
import {verifySupabaseUser} from '../server/auth.mjs';
const recent=new Map();
function allowed(id){
  const now=Date.now();const prev=recent.get(id);
  const r=prev&&now-prev.start<60_000?prev:{start:now,n:0};r.n++;recent.set(id,r);
  if(recent.size>400){for(const [id,v] of recent){if(now-v.start>60_000)recent.delete(id)}}
  return r.n<=24;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'仅支持 GET'})}
  try{
    const url=new URL(req.url||'/api/subject','https://localhost');
    const category=url.searchParams.get('category'),id=url.searchParams.get('id');
    if(!['anime','game'].includes(category)||!/^[1-9]\d{0,11}$/.test(id||''))return res.status(400).json({error:'无效的条目参数'});
    const token=(/^Bearer (.+)$/i.exec(req.headers.authorization||'')||[])[1];
    const userId=await verifySupabaseUser(token);
    if(!allowed(userId))return res.status(429).json({error:'请求过于频繁'});
    return res.status(200).json({item:await bangumiDetail(category,id)});
  }catch(err){return res.status([400,401,403,404,429,503].includes(err.status)?err.status:502).json({error:String(err.message||err).slice(0,180)});}
}
