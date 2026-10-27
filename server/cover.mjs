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
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(9000),
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
export async function fetchBangumiSubjectCover(subjectId,fetcher=fetch,env=process.env){
  const id=getCoverSubjectId(subjectId);
  let firstError;
  try{
    const resp=await fetcher(`https://api.bgm.tv/v0/subjects/${id}/image?type=large`,{
      redirect:'manual',signal:AbortSignal.timeout(7000),headers:{Accept:'image/jpeg,image/png,image/webp,image/avif', 'User-Agent':String(env.BANGUMI_USER_AGENT||'Tongpin/0.5.4 (cover gateway)')}
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
  // If the image endpoint is down or has a changed redirect, obtain the
  // official subject metadata and reuse the existing strictly allowlisted proxy.
  try{
    const resp=await fetcher(`https://api.bgm.tv/v0/subjects/${id}`,{
      redirect:'manual',signal:AbortSignal.timeout(6500),headers:{Accept:'application/json','User-Agent':String(env.BANGUMI_USER_AGENT||'Tongpin/0.5.4 (cover gateway)')}
    });
    if(!resp.ok)throw new Error(`Subject HTTP ${resp.status}`);
    const json=await resp.json();
    const path=imagePathFromLocation(json?.images?.large||json?.images?.common||json?.images?.medium||'');
    if(!path)throw new Error('No approved subject cover');
    return await fetchBangumiCover(path,fetcher,env);
  }catch(err){
    // Curated V0.3 starter titles only: a verified ID crosswalk can fetch
    // their official MAL/Jikan artwork when Bangumi is unreachable.
    // Do not guess arbitrary Anime<->MAL matches automatically.
    const malId=MAL_LEGACY_IDS[id];
    if(malId && env.JIKAN_FALLBACK!=='0'){
      try{
        const r=await fetcher(`https://api.jikan.moe/v4/anime/${malId}`,{redirect:'manual',signal:AbortSignal.timeout(6500),headers:{Accept:'application/json'}});
        if(!r.ok)throw new Error(`Jikan HTTP ${r.status}`);
        const obj=await r.json();const raw=obj?.data?.images?.jpg?.large_image_url||obj?.data?.images?.jpg?.image_url;
        const u=new URL(raw);const hosts={'cdn.myanimelist.net':'mal','images.myanimelist.net':'mal_old','api-cdn.myanimelist.net':'mal_api'};
        const provider=hosts[u.hostname];
        if(u.protocol!=='https:'||!provider)throw new Error('Unexpected MAL image origin');
        return await fetchMediaCover(provider,u.pathname,fetcher);
      }catch(malError){throw Object.assign(new Error('Bangumi and MAL cover unavailable'),{cause:[firstError,err,malError]});}
    }
    throw Object.assign(new Error('Bangumi subject cover unavailable'),{cause:[firstError,err]});
  }
}

