/* 同频 V0.4.4：仅服务端运行。无第三方密钥或 Supabase JWT 写入客户端。 */
import {bangumiRequest} from './bangumi-transport.mjs';
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

async function readJSON(url, opts={}, timeoutMs=7500, fetcher=fetch) {
  const response = await fetcher(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`数据源返回 HTTP ${response.status}`);
  return response.json();
}

export function normalizeBangumi(payload,category) {
  return (Array.isArray(payload?.data)?payload.data:[]).filter(x=>x?.id!=null).slice(0,14).map(x=>({
    category,provider:'bangumi',providerId:String(x.id),
    name:text(x.name_cn || x.name || '未命名作品',100),
    subtitle:text(x.name_cn ? x.name : (x.name_cn||''),120),
    description:text(x.summary || '',500),
    coverUrl:safeBangumiCover(x.images?.large || x.images?.common || x.images?.medium),
    sourceUrl:`https://bgm.tv/subject/${encodeURIComponent(String(x.id))}`,
    year: /^\d{4}/.test(String(x.date||'')) ? String(x.date).slice(0,4) : '',
    emoji:category==='anime'?'📺':'🎮',
  }));
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

export function normalizeAmap(payload){
  return (Array.isArray(payload?.pois)?payload.pois:[]).filter(x=>x?.id&&x?.name).slice(0,15).map(x=>({
    category:'place',provider:'amap',providerId:String(x.id),name:text(x.name,100),
    subtitle:text([Array.isArray(x.pname)?x.pname[0]:x.pname,Array.isArray(x.cityname)?x.cityname[0]:x.cityname,Array.isArray(x.adname)?x.adname[0]:x.adname].filter(Boolean).join(' · '),120),
    description:'',coverUrl:'',sourceUrl:'',year:'',emoji:'📍'
  }));
}

export async function bangumiSearch(category,query,fetcher=fetch,env=process.env) {
  const body = JSON.stringify({keyword:query,sort:'match',filter:{type:[category==='anime'?2:4],nsfw:false}});
  const payload=await bangumiRequest('/v0/search/subjects?limit=14',{
    method:'POST',headers:{'Content-Type':'application/json'},body
  },{fetcher,env});
  return normalizeBangumi(payload,category);
}

let tokenCache={value:'',expires:0};
export async function igdbSearch(query,fetcher=fetch,env=process.env){
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
  const statement=`search "${value}"; fields id,name,summary,slug,url,cover.image_id,first_release_date; limit 12;`;
  const payload=await readJSON('https://api.igdb.com/v4/games',{
    method:'POST',headers:{'Client-ID':env.IGDB_CLIENT_ID,'Authorization':`Bearer ${tokenCache.value}`,'Content-Type':'text/plain'},body:statement
  },8000,fetcher);
  return {items:normalizeIGDB(payload),configured:true};
}

export async function amapSearch(query,fetcher=fetch,env=process.env) {
  if(!env.AMAP_WEB_KEY)return {items:[],configured:false};
  const url=new URL('https://restapi.amap.com/v5/place/text');
  url.searchParams.set('key',env.AMAP_WEB_KEY);
  url.searchParams.set('keywords',query);
  url.searchParams.set('page_size','15');
  url.searchParams.set('page_num','1');
  const payload=await readJSON(url.toString(),{},6500,fetcher);
  if(String(payload.status)!=='1')throw new Error(`高德搜索失败：${text(payload.info||'未知错误',80)}`);
  return {items:normalizeAmap(payload),configured:true};
}

const memo = new Map();
const pending = new Map();
async function runSearchCatalog(category,keyword,{fetcher=fetch,env=process.env}={}){
  const query=validateSearch(category,keyword);
  const key=`${category}:${query.toLowerCase()}`;
  const cached=memo.get(key);
  if(cached && cached.until>Date.now())return {...cached.data,cached:true};
  const notices=[];let items=[];
  if(category==='anime'||category==='game'){
    try{items=await bangumiSearch(category,query,fetcher,env)}
    catch(e){notices.push('Bangumi 暂时不可用：'+errorMessage(e));}
    if(category==='game' && env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET){
      try{const igdb=await igdbSearch(query,fetcher,env);items.push(...igdb.items)}
      catch(e){notices.push('IGDB 暂时不可用：'+errorMessage(e));}
    }else if(category==='game') notices.push('未配置 IGDB，当前只检索 Bangumi 游戏条目');
  }else{
    try{const result=await amapSearch(query,fetcher,env);items=result.items;
      if(!result.configured)notices.push('未配置高德 Web 服务 Key');
    }catch(e){notices.push('高德地点搜索暂时不可用：'+errorMessage(e));}
  }
  // 同源去重；不同来源即使同名也保留，入库时再检查已有作品名称。
  const seen=new Set();items=items.filter(x=>{const id=x.provider+':'+x.providerId;if(seen.has(id))return false;seen.add(id);return true;}).slice(0,25);
  const data={items,notices,category,query,cached:false};
  memo.set(key,{until:Date.now()+(items.length?5:1)*60_000,data});
  if(memo.size>250)memo.delete(memo.keys().next().value);
  return data;
}

/** Coalesce simultaneous identical queries on a warm Vercel instance. */
export async function searchCatalog(category, keyword, options = {}) {
  const validated = validateSearch(category,keyword);
  const key = `${category}:${validated.toLowerCase()}`;
  if (pending.has(key)) return pending.get(key);
  const p = runSearchCatalog(category, validated, options);
  pending.set(key,p);
  try { return await p; } finally { if(pending.get(key) === p) pending.delete(key); }
}
