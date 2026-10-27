/**
 * Restricted read-only Bangumi cover endpoint.
 * The browser only submits an approved cover path, never a URL/host.
 * Optional fallback host is a fixed server-side choice, disabled by default.
 */
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
