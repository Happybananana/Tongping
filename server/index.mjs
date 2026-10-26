import http from 'node:http';
import {searchCatalog,validateSearch} from './search.mjs';

const port=Number(process.env.PORT||8787);
const allowedOrigins = new Set(String(process.env.ALLOWED_ORIGINS||'http://localhost:5173').split(',').map(x=>x.trim()).filter(Boolean));
const supabaseUrl=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const publishableKey=String(process.env.SUPABASE_PUBLISHABLE_KEY||'');
const recent=new Map();
function json(res,status,data,origin=''){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Vary':'Origin',
    ...(origin ? {'Access-Control-Allow-Origin':origin} : {})
  });res.end(JSON.stringify(data));
}
function rateLimit(ip){
  const now=Date.now();const value=recent.get(ip)||{window:now,count:0};
  if(now-value.window>60_000){value.window=now;value.count=0;}
  value.count++;recent.set(ip,value);
  if(recent.size>2000){for(const [key,v] of recent)if(now-v.window>60_000)recent.delete(key);}
  return value.count<=60;
}
async function verifyJWT(jwt){
  if(!supabaseUrl || !publishableKey)throw Object.assign(new Error('搜索服务没有配置 Supabase 验证参数'),{status:503});
  if(!jwt || jwt.length>5000)throw Object.assign(new Error('请先登录'),{status:401});
  const resp=await fetch(`${supabaseUrl}/auth/v1/user`,{
    headers:{Authorization:`Bearer ${jwt}`,apikey:publishableKey},signal:AbortSignal.timeout(7500)
  });
  if(!resp.ok)throw Object.assign(new Error('登录凭证无效，请重新登录'),{status:401});
  const data=await resp.json();
  if(!data.id)throw Object.assign(new Error('无法识别用户'),{status:401});
  return data.id;
}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin||'';
  if(origin && !allowedOrigins.has(origin)){json(res,403,{error:'不允许的来源'});return;}
  if(req.method==='OPTIONS'){
    res.writeHead(204,{
      ...(origin?{'Access-Control-Allow-Origin':origin}:{}),
      'Access-Control-Allow-Methods':'GET, OPTIONS',
      'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'});
    res.end();return;
  }
  let path;
  try{path=new URL(req.url||'/',`http://localhost:${port}`)}catch{json(res,400,{error:'无效 URL'},origin);return;}
  if(path.pathname==='/api/health'&&req.method==='GET'){json(res,200,{ok:true,service:'tongpin-search-v0.4'},origin);return;}
  if(path.pathname!=='/api/search'||req.method!=='GET'){json(res,404,{error:'接口不存在'},origin);return;}
  if(!rateLimit(req.socket.remoteAddress||'unknown')){json(res,429,{error:'搜索过于频繁，请稍后再试'},origin);return;}
  try{
    const category=path.searchParams.get('category');const q=path.searchParams.get('q');
    validateSearch(category,q);
    const jwt=(/^Bearer (.+)$/i.exec(req.headers.authorization||'')||[])[1];
    await verifyJWT(jwt);
    const data=await searchCatalog(category,q);
    json(res,200,data,origin);
  }catch(err){
    const status=Number(err.status)||502;
    json(res,status>=400&&status<600?status:502,{error:String(err.message||err).slice(0,180)},origin);
  }
});
server.listen(port,'0.0.0.0',()=>console.log(`[同频搜索服务] http://localhost:${port}`));
