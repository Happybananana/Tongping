/** Fixed-origin public media proxy for Jikan/MAL, RAWG and IGDB. No arbitrary URLs. */
const PROVIDERS={
  mal:{host:'https://cdn.myanimelist.net',path:/^\/images\/anime\/\d{1,8}\/\d{1,12}(?:[A-Za-z0-9_.-]*)\.(?:jpe?g|png|webp)$/i},
  mal_api:{host:'https://api-cdn.myanimelist.net',path:/^\/images\/anime\/\d{1,8}\/\d{1,12}(?:[A-Za-z0-9_.-]*)\.(?:jpe?g|png|webp)$/i},
  mal_old:{host:'https://images.myanimelist.net',path:/^\/images\/anime\/\d{1,8}\/\d{1,12}(?:[A-Za-z0-9_.-]*)\.(?:jpe?g|png|webp)$/i},
  rawg:{host:'https://media.rawg.io',path:/^\/media\/(?:games|screenshots|resize)\/[a-z0-9/_-]+\.(?:jpe?g|png|webp)$/i},
  steam:{host:'https://shared.fastly.steamstatic.com',path:/^\/store_item_assets\/steam\/apps\/\d{1,12}\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i},
  igdb:{host:'https://images.igdb.com',path:/^\/igdb\/image\/upload\/t_[a-z_]+\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i}
};
const TYPES=new Set(['image/jpeg','image/png','image/webp']);const MAX=5*1024*1024;
export function parseMediaCover(provider,path){
  const p=PROVIDERS[provider];
  if(!p || typeof path!=='string' || path.length>240 || !p.path.test(path) || path.includes('..'))throw Object.assign(new Error('Invalid media cover'),{status:400});
  return p.host+path;
}
export async function fetchMediaCover(provider,path,fetcher=fetch){
  const url=parseMediaCover(provider,path);
  const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(4800),headers:{Accept:'image/jpeg,image/png,image/webp'}});
  if(!response.ok)throw new Error(`Media HTTP ${response.status}`);
  const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase().trim();
  if(!TYPES.has(type))throw new Error('Unexpected media type');
  if(Number(response.headers.get('content-length')||0)>MAX)throw Object.assign(new Error('Image too large'),{status:413});
  if(!response.body)throw new Error('No image bytes');
  const chunks=[];let total=0;
  for await(const chunk of response.body){total+=chunk.byteLength;if(total>MAX)throw Object.assign(new Error('Image too large'),{status:413});chunks.push(Buffer.from(chunk));}
  return {bytes:Buffer.concat(chunks,total),contentType:type};
}
