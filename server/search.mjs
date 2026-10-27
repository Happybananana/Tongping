/* 同频 V0.4.4：仅服务端运行。无第三方密钥或 Supabase JWT 写入客户端。 */
import {bangumiRequest} from './bangumi-transport.mjs';
import {normalizeBangumiSubject} from './bangumi-metadata.mjs';
const CATEGORIES = new Set(['anime','game','place']);
const MAX_QUERY = 65;
const clean = (value) => String(value ?? '').trim().slice(0, 180);
const safeUrl = (url) => { try { const u = new URL(url); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const safeBangumiCover = (url) => { try { const u = new URL(url); if(u.hostname.toLowerCase()==='lain.bgm.tv' && !u.port && (u.protocol==='http:' || u.protocol==='https:')) {u.protocol='https:';return u.href;} return safeUrl(url); }catch{return '';} };
const text = (x,max=500) => clean(x).slice(0,max);
const errorMessage = (err) => err instanceof Error ? err.message : String(err);

export function validateSearch(category, keyword) {
  if (!CATEGORIES.has(category)) throw Object.assign(new Error('类别应为 anime、game 或 place'),{status:400});
  const query = String(keyword ?? '').trim();
  if (query.length < 2 || query.length > MAX_QUERY) throw Object.assign(new Error('请输入 2–65 个字符的关键词'),{status:400});
  return query;
}

export function validatePage(raw){const number=Number(raw??1);if(!Number.isSafeInteger(number)||number<1||number>100)throw Object.assign(new Error('页码必须在 1–100 之间'),{status:400});return number;}

async function readJSON(url, opts={}, timeoutMs=7500, fetcher=fetch) {
  const response = await fetcher(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`数据源返回 HTTP ${response.status}`);
  return response.json();
}

export function normalizeBangumi(payload,category) {
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map(x=>normalizeBangumiSubject(x,category)).filter(Boolean).slice(0,14);
}

// Obtain richer tags, rating stats and platform on demand; do not fetch full details
// for every search hit. The detail request uses the same Bangumi failover transport.
export async function bangumiDetail(category,id,fetcher=fetch,env=process.env){
  if(!['anime','game'].includes(category) || !/^[1-9]\d{0,11}$/.test(String(id)))
    throw Object.assign(new Error('非法的 Bangumi 条目参数'),{status:400});
  const payload=await bangumiRequest(`/v0/subjects/${id}`,{}, {fetcher,env});
  const item=normalizeBangumiSubject(payload,category);
  if(!item) throw Object.assign(new Error('Bangumi 条目类型不匹配'),{status:404});
  return item;
}

export function normalizeIGDB(payload){
  return (Array.isArray(payload)?payload:[]).filter(x=>x?.id!=null).slice(0,12).map(x=>({
    category:'game',provider:'igdb',providerId:String(x.id),
    name:text(x.name||'未命名游戏',100), subtitle:'IGDB · 游戏',
    description:text(x.summary||'',500),
    coverUrl: x.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${encodeURIComponent(x.cover.image_id)}.jpg` : '',
    sourceUrl:safeUrl(x.url||`https://www.igdb.com/games/${encodeURIComponent(x.slug||String(x.id))}`),
    year:Number.isFinite(x.first_release_date)?String(new Date(x.first_release_date*1000).getUTCFullYear()):'',
    emoji:'🎮'
  }));
}


/** No-key Jikan is an unofficial read-only index of MAL, not the MAL official API.
 * Used only when Bangumi has no hits or is unavailable to respect Jikan limits.
 */
export function normalizeJikan(payload){
  return (Array.isArray(payload?.data)?payload.data:[]).filter(x=>Number.isInteger(x?.mal_id)&&x.mal_id>0).slice(0,12).map(x=>({
    category:'anime',provider:'jikan',providerId:String(x.mal_id),
    name:text(x.title||x.title_english||'未命名动画',100),
    subtitle:text([x.title_japanese,x.title_english].filter(Boolean).join(' · '),120),
    description:text(x.synopsis||'',500),
    coverUrl:safeUrl(x.images?.jpg?.large_image_url||x.images?.jpg?.image_url||''),
    sourceUrl:safeUrl(x.url||`https://myanimelist.net/anime/${x.mal_id}`),
    year:x.year?String(x.year):'',
    emoji:'📺',platform:text(x.type||'',40),
    tags:(Array.isArray(x.genres)?x.genres:[]).map(a=>text(a.name,30)).filter(Boolean).slice(0,5),
    externalScore:Number.isFinite(Number(x.score)) && Number(x.score)>0?Number(x.score):null,
    externalScoreSource:'MAL'
  }));
}
export async function jikanSearch(query,fetcher=fetch,page=1){
  const url=new URL('https://api.jikan.moe/v4/anime');
  url.searchParams.set('q',query);url.searchParams.set('limit','12');url.searchParams.set('page',String(page));url.searchParams.set('sfw','true');
  const payload=await readJSON(url.toString(),{},6500,fetcher);
  return {items:normalizeJikan(payload),hasMore:!!payload.pagination?.has_next_page};
}
export function normalizeRAWG(payload){
  return (Array.isArray(payload?.results)?payload.results:[]).filter(x=>Number.isInteger(x?.id)&&x.id>0).slice(0,12).map(x=>({
    category:'game',provider:'rawg',providerId:String(x.id),name:text(x.name||'未命名游戏',100),
    subtitle:text(x.released?`RAWG · ${x.released}`:'RAWG · 游戏',120),description:'',
    coverUrl:safeUrl(x.background_image||''),
    sourceUrl:safeUrl(`https://rawg.io/games/${encodeURIComponent(x.slug||String(x.id))}`),
    year:/^\d{4}/.test(x.released||'')?x.released.slice(0,4):'',emoji:'🎮',
    tags:(Array.isArray(x.genres)?x.genres:[]).map(a=>text(a.name,30)).filter(Boolean).slice(0,5),
    platform:(Array.isArray(x.platforms)?x.platforms:[]).map(p=>p.platform?.name).filter(Boolean).slice(0,2).join(' / '),
    externalScore:Number.isFinite(Number(x.rating)) && Number(x.rating)>0?Number(x.rating):null,
    externalScoreSource:'RAWG',externalScoreMax:5
  }));
}
export async function rawgSearch(query,fetcher=fetch,env=process.env,page=1){
  const key=String(env.RAWG_API_KEY||'').trim();if(!key)return {configured:false,items:[],hasMore:false};
  const url=new URL('https://api.rawg.io/api/games');
  url.searchParams.set('key',key);url.searchParams.set('search',query);
  url.searchParams.set('page',String(page));url.searchParams.set('page_size','12');
  const payload=await readJSON(url.toString(),{},7500,fetcher);
  return {configured:true,items:normalizeRAWG(payload),hasMore:!!payload.next};
}

export function normalizeAmap(payload){
  return (Array.isArray(payload?.pois)?payload.pois:[]).filter(x=>x?.id&&x?.name).slice(0,15).map(x=>({
    category:'place',provider:'amap',providerId:String(x.id),name:text(x.name,100),
    subtitle:text([Array.isArray(x.pname)?x.pname[0]:x.pname,Array.isArray(x.cityname)?x.cityname[0]:x.cityname,Array.isArray(x.adname)?x.adname[0]:x.adname].filter(Boolean).join(' · '),120),
    description:'',coverUrl:'',sourceUrl:'',year:'',emoji:'📍'
  }));
}

export async function bangumiSearch(category,query,fetcher=fetch,env=process.env,page=1) {
  const body = JSON.stringify({keyword:query,sort:'match',filter:{type:[category==='anime'?2:4],nsfw:false}});
  const payload=await bangumiRequest(`/v0/search/subjects?limit=14&offset=${(page-1)*14}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body
  },{fetcher,env});
  return normalizeBangumi(payload,category);
}

let tokenCache={value:'',expires:0};
export async function igdbSearch(query,fetcher=fetch,env=process.env,page=1){
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return {items:[],configured:false};
  if (Date.now()+90_000>=tokenCache.expires) {
    const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
    tokenUrl.searchParams.set('client_id',env.IGDB_CLIENT_ID);
    tokenUrl.searchParams.set('client_secret',env.IGDB_CLIENT_SECRET);
    tokenUrl.searchParams.set('grant_type','client_credentials');
    const payload=await readJSON(tokenUrl.toString(),{method:'POST'},8000,fetcher);
    if(!payload.access_token)throw new Error('IGDB 令牌获取失败');
    tokenCache={value:payload.access_token,expires:Date.now()+Number(payload.expires_in||3600)*1000};
  }
  // APICalypse 防注入：所有引号、反斜杠和非文字字符均被规范化；不拼用户提供的字段表达式。
  const value=query.replace(/[\\"\r\n;]/g,' ').replace(/\s+/g,' ').trim();
  const statement=`search "${value}"; fields id,name,summary,slug,url,cover.image_id,first_release_date; limit 12; offset ${(page-1)*12};`;
  const payload=await readJSON('https://api.igdb.com/v4/games',{
    method:'POST',headers:{'Client-ID':env.IGDB_CLIENT_ID,'Authorization':`Bearer ${tokenCache.value}`,'Content-Type':'text/plain'},body:statement
  },8000,fetcher);
  return {items:normalizeIGDB(payload),configured:true};
}

export async function amapSearch(query,fetcher=fetch,env=process.env,page=1) {
  if(!env.AMAP_WEB_KEY)return {items:[],configured:false};
  const url=new URL('https://restapi.amap.com/v5/place/text');
  url.searchParams.set('key',env.AMAP_WEB_KEY);
  url.searchParams.set('keywords',query);
  url.searchParams.set('page_size','15');
  url.searchParams.set('page_num',String(page));
  const payload=await readJSON(url.toString(),{},6500,fetcher);
  if(String(payload.status)!=='1')throw new Error(`高德搜索失败：${text(payload.info||'未知错误',80)}`);
  return {items:normalizeAmap(payload),configured:true};
}

const memo = new Map();
const pending = new Map();
async function runSearchCatalog(category,keyword,{fetcher=fetch,env=process.env,page=1}={}){
  const query=validateSearch(category,keyword);
  page=validatePage(page);
  const key=`${category}:${query.toLowerCase()}:p${page}`;
  const cached=memo.get(key);
  if(cached && cached.until>Date.now())return {...cached.data,cached:true};
  const notices=[];let items=[];let hasMore=false;
  if(category==='anime'||category==='game'){
    let bangumiFailed=false;
    try{items=await bangumiSearch(category,query,fetcher,env,page);hasMore=items.length>=14;}
    catch(e){bangumiFailed=true;notices.push('Bangumi 暂时不可用：'+errorMessage(e));}
    if(category==='anime'&&(bangumiFailed||items.length===0)&&env.JIKAN_FALLBACK!=='0'){
      try{const j=await jikanSearch(query,fetcher,page);items.push(...j.items);hasMore=hasMore||j.hasMore;
        if(j.items.length)notices.push('已启用 MyAnimeList / Jikan 备用搜索；英文或日文关键词更容易匹配');
      }catch(e){notices.push('Jikan / MAL 备用搜索暂时不可用：'+errorMessage(e));}
    }
    if(category==='game'){
      // Game providers are independent. A failing IGDB auth must not suppress RAWG.
      const searches=[];
      if(env.IGDB_CLIENT_ID&&env.IGDB_CLIENT_SECRET)searches.push(igdbSearch(query,fetcher,env,page).then(r=>({source:'IGDB',...r})).catch(e=>({source:'IGDB',error:e})));
      if(env.RAWG_API_KEY)searches.push(rawgSearch(query,fetcher,env,page).then(r=>({source:'RAWG',...r})).catch(e=>({source:'RAWG',error:e})));
      for(const result of await Promise.all(searches)){
        if(result.error)notices.push(result.source+' 暂时不可用：'+errorMessage(result.error));
        else {items.push(...result.items);hasMore=hasMore||result.hasMore||result.items.length>=12;}
      }
      if(!searches.length)notices.push('如需更多游戏来源，可配置 IGDB 或 RAWG_API_KEY（需要来源署名）');
    }
  }else{
    try{const result=await amapSearch(query,fetcher,env,page);items=result.items;hasMore=items.length>=15;
      if(!result.configured)notices.push('未配置高德 Web 服务 Key');
    }catch(e){notices.push('高德地点搜索暂时不可用：'+errorMessage(e));}
  }
  // 同源去重；不同来源即使同名也保留，入库时再检查已有作品名称。
  const seen=new Set();items=items.filter(x=>{const id=x.provider+':'+x.providerId;if(seen.has(id))return false;seen.add(id);return true;}).slice(0,25);
  const data={items,notices,category,query,page,hasMore,cached:false};
  memo.set(key,{until:Date.now()+(items.length?5:1)*60_000,data});
  if(memo.size>250)memo.delete(memo.keys().next().value);
  return data;
}

/** Coalesce simultaneous identical queries on a warm Vercel instance. */
export async function searchCatalog(category, keyword, options = {}) {
  const validated = validateSearch(category,keyword);
  const page=validatePage(options.page??1);
  const key = `${category}:${validated.toLowerCase()}:p${page}`;
  if (pending.has(key)) return pending.get(key);
  const p = runSearchCatalog(category, validated, {...options,page});
  pending.set(key,p);
  try { return await p; } finally { if(pending.get(key) === p) pending.delete(key); }
}
