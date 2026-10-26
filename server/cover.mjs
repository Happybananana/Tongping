/**
 * Bangumi 封面白名单与安全拉取。仅支持图片，限制大小、重定向与超时。
 */
const COVER_PATH=/^\/(?:r\/(?:100|200|400|600)\/)?pic\/cover\/[lcmsg]\/[a-z0-9]{2}\/[a-z0-9]{2}\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i;
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp','image/avif']);
const MAX_BYTES=5*1024*1024;

export function getCoverPath(value){
  if(typeof value!=='string' || value.length>250 || !COVER_PATH.test(value))throw new Error('Invalid cover path');
  return value;
}

export async function fetchBangumiCover(path,fetcher=fetch){
  const validated=getCoverPath(path);
  const result=await fetcher(`https://lain.bgm.tv${validated}`,{
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(9000),
    headers:{'Accept':'image/jpeg,image/png,image/webp,image/avif;q=0.8','User-Agent':'Tongpin/0.4.3 (Bangumi cover display)'}
  });
  if(!result.ok)throw new Error(`Upstream status ${result.status}`);
  const contentType=(result.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!ALLOWED_TYPES.has(contentType))throw new Error('Unexpected content type');
  const length=Number(result.headers.get('content-length')||0);
  if(length>MAX_BYTES)throw Object.assign(new Error('Cover too large'),{status:413});
  if(!result.body)throw new Error('No image data');
  let total=0;const chunks=[];
  // 流式计数，避免第三方忽略 Content-Length 导致内存无界增长。
  for await (const chunk of result.body){
    total+=chunk.byteLength;
    if(total>MAX_BYTES)throw Object.assign(new Error('Cover too large'),{status:413})
    chunks.push(Buffer.from(chunk));
  }
  return {contentType,bytes:Buffer.concat(chunks,total)};
}
