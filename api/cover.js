/**
 * 只读 Bangumi 封面网关。
 * 严格限制上游域名和路径，禁止把用户任意 URL 作为代理目标（SSRF 防护）。
 * 图片面向所有访问者公开，无需 Supabase JWT，不缓存任何认证或用户数据。
 */
import {getCoverPath, fetchBangumiCover} from '../server/cover.mjs';

export default async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(req.method)){
    res.setHeader('Allow','GET, HEAD');
    return res.status(405).end('Method Not Allowed');
  }
  let path;
  try{path=getCoverPath(req.query?.path)}
  catch{return res.status(400).end('Invalid cover path')}
  try{
    const result=await fetchBangumiCover(path);
    res.setHeader('Content-Type',result.contentType);
    res.setHeader('Cache-Control','public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400');
    res.setHeader('Content-Length',String(result.bytes.length));
    return res.status(200).end(req.method==='HEAD'?undefined:result.bytes);
  }catch(err){
    res.setHeader('Cache-Control','no-store');
    return res.status(err.status===413?413:502).end('Cover temporarily unavailable');
  }
}
