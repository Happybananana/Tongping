import {parseMediaCover,fetchMediaCover} from '../server/media-cover.mjs';
export default async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return res.status(405).end('Method Not Allowed')}
  try{
    const provider=req.query?.provider,path=req.query?.path;
    parseMediaCover(provider,path);
    const data=await fetchMediaCover(provider,path);
    res.setHeader('Content-Type',data.contentType);
    res.setHeader('Cache-Control','public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400');
    res.setHeader('Content-Length',String(data.bytes.length));
    return res.status(200).end(req.method==='HEAD'?undefined:data.bytes);
  }catch(err){res.setHeader('Cache-Control','no-store');return res.status(err.status===400?400:err.status===413?413:502).end('Media unavailable')}
}
