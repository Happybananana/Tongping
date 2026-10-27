/**
 * Restricted read-only Bangumi cover endpoint.
 * The browser only submits an approved cover path, never a URL/host.
 * Optional fallback host is a fixed server-side choice, disabled by default.
 */
import {fetchMediaCover} from './media-cover.mjs';
const MAL_LEGACY_IDS=Object.freeze({'400602':52991,'10380':9253,'183878':33352,'1428':5114});
const COVER_PATH=/^\/(?:r\/(?:100|200|400|600|800)\/)?pic\/cover\/[lcmsg]\/[a-z0-9]{2}\/[a-z0-9]{2}\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i;
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp','image/avif']);
const MAX_BYTES=5*1024*1024;
const SOURCES=['https://lain.bgm.tv','https://bgmimg.anibt.net'];

export function getCoverPath(value){
  if(typeof value!=='string' || value.length>250 || !COVER_PATH.test(value))throw new Error('Invalid cover path');
  return value;
}

async function imageFrom(host,path,fetcher){
  const response=await fetcher(`${host}${path}`,{
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(4800),
    headers:{'Accept':'image/jpeg,image/png,image/webp,image/avif;q=0.8',
      'Referer':'https://bgm.tv/','User-Agent':'Tongpin/0.4.4 (Bangumi cover)'}
  });
  if(!response.ok)throw new Error(`Upstream status ${response.status}`);
  const contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!ALLOWED_TYPES.has(contentType))throw new Error('Unexpected content type');
  const length=Number(response.headers.get('content-length')||0);
  if(length>MAX_BYTES)throw Object.assign(new Error('Cover too large'),{status:413});
  if(!response.body)throw new Error('No image data');
  let total=0;const chunks=[];
  for await (const chunk of response.body){
    total+=chunk.byteLength;
    if(total>MAX_BYTES)throw Object.assign(new Error('Cover too large'),{status:413});
    chunks.push(Buffer.from(chunk));
  }
  return {contentType,bytes:Buffer.concat(chunks,total)};
}

export async function fetchBangumiCover(path,fetcher=fetch,env=process.env){
  const validated=getCoverPath(path);
  const hosts=env.BANGUMI_COVER_MIRROR==='1'?SOURCES:[SOURCES[0]];
  let lastError;
  for(const host of hosts){
    try{return await imageFrom(host,validated,fetcher)}
    catch(err){
      lastError=err;
      // Oversize is a content-policy decision, don't fetch it again from mirror.
      if(err?.status===413)throw err;
    }
  }
  throw lastError||new Error('Cover unavailable');
}

/** Legacy V0.3 starter anime store a Bangumi subject-image endpoint, not a
 *  lain.bgm.tv image. Resolve it only on the server so mainland browsers never
 *  load api.bgm.tv directly. Neither the subject id nor the redirect can pick a host. */
export function getCoverSubjectId(value){
  if(typeof value!=='string' || !/^[1-9][0-9]{0,11}$/.test(value))throw new Error('Invalid Bangumi subject id');
  return value;
}
function imagePathFromLocation(value){
  try{
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol) || url.hostname!=='lain.bgm.tv' || url.port || url.username || url.password)return '';
    return getCoverPath(url.pathname);
  }catch{return ''}
}
// Legacy fixed IDs can be resolved by two independent official/public artwork
// routes. Race both rather than waiting through several serial timeouts.
// The fallback ID mapping is fixed: user-supplied ids never select a URL/host.
async function fetchCuratedMalCover(id,fetcher){
  const malId=MAL_LEGACY_IDS[id];
  if(!malId)throw new Error('No curated MAL mapping');
  const r=await fetcher(`https://api.jikan.moe/v4/anime/${malId}`,{
    redirect:'manual',signal:AbortSignal.timeout(4500),headers:{Accept:'application/json'}
  });
  if(!r.ok)throw new Error(`Jikan HTTP ${r.status}`);
  const obj=await r.json();
  const raw=obj?.data?.images?.jpg?.large_image_url||obj?.data?.images?.jpg?.image_url;
  if(typeof raw!=='string')throw new Error('No Jikan image');
  const u=new URL(raw);
  const hosts={'cdn.myanimelist.net':'mal','images.myanimelist.net':'mal_old','api-cdn.myanimelist.net':'mal_api'};
  const provider=hosts[u.hostname];
  if(u.protocol!=='https:'||!provider||u.port||u.search)throw new Error('Unexpected MAL image origin');
  return fetchMediaCover(provider,u.pathname,fetcher);
}
async function fetchOfficialSubjectCover(id,fetcher,env,{skipDetail=false}={}){
  let firstError;
  try{
    const resp=await fetcher(`https://api.bgm.tv/v0/subjects/${id}/image?type=large`,{
      redirect:'manual',signal:AbortSignal.timeout(3500),headers:{Accept:'image/jpeg,image/png,image/webp,image/avif', 'User-Agent':String(env.BANGUMI_USER_AGENT||'Tongpin/0.5.5 (cover gateway)')}
    });
    if([301,302,303,307,308].includes(resp.status)){
      const next=imagePathFromLocation(resp.headers.get('location'));
      if(!next)throw new Error('Unapproved image redirect');
      return await fetchBangumiCover(next,fetcher,env);
    }
    if(resp.ok){
      const type=(resp.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(ALLOWED_TYPES.has(type)){
        const length=Number(resp.headers.get('content-length')||0);
        if(length>MAX_BYTES)throw Object.assign(new Error('Cover too large'),{status:413});
        let size=0;const chunks=[];
        if(!resp.body)throw new Error('No image data');
        for await(const chunk of resp.body){size+=chunk.byteLength;if(size>MAX_BYTES)throw Object.assign(new Error('Cover too large'),{status:413});chunks.push(Buffer.from(chunk))}
        return {contentType:type,bytes:Buffer.concat(chunks,size)};
      }
    }
    throw new Error(`Bangumi image HTTP ${resp.status}`);
  }catch(err){
    if(err.status===413)throw err;
    firstError=err;
  }
  // Four curated initial anime have an independent verified MAL route; avoid
  // fetching a second Bangumi metadata URL after an image failure.
  if(skipDetail)throw Object.assign(new Error('Bangumi subject image unavailable'),{cause:firstError});
  // Detail fallback is bounded; unlike v0.5.4 it no longer waits 7s+6.5s
  // before *starting* a second independent source.
  try{
    const resp=await fetcher(`https://api.bgm.tv/v0/subjects/${id}`,{
      redirect:'manual',signal:AbortSignal.timeout(3500),headers:{Accept:'application/json','User-Agent':String(env.BANGUMI_USER_AGENT||'Tongpin/0.5.5 (cover gateway)')}
    });
    if(!resp.ok)throw new Error(`Subject HTTP ${resp.status}`);
    const json=await resp.json();
    const path=imagePathFromLocation(json?.images?.large||json?.images?.common||json?.images?.medium||'');
    if(!path)throw new Error('No approved subject cover');
    return await fetchBangumiCover(path,fetcher,env);
  }catch(err){
    throw Object.assign(new Error('Bangumi subject cover unavailable'),{cause:[firstError,err]});
  }
}
export async function fetchBangumiSubjectCover(subjectId,fetcher=fetch,env=process.env){
  const id=getCoverSubjectId(subjectId);
  if(!MAL_LEGACY_IDS[id]||env.JIKAN_FALLBACK==='0')return fetchOfficialSubjectCover(id,fetcher,env);
  try{
    return await Promise.any([fetchOfficialSubjectCover(id,fetcher,env,{skipDetail:true}),fetchCuratedMalCover(id,fetcher)]);
  }catch(err){
    throw Object.assign(new Error('Bangumi and MAL cover unavailable'),{cause:err});
  }
}
