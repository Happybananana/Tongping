import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './search.js';
import {verifySupabaseUser} from '../server/auth.mjs';

function response(){
  return {
    statusCode:0,headers:{},payload:null,
    setHeader(k,v){this.headers[k]=v;},
    status(status){this.statusCode=status;return this;},
    json(payload){this.payload=payload;return this;}
  }
}

test('Vercel API 禁止非 GET 方法且设置不缓存响应头',async()=>{
  const res=response();await handler({method:'POST',url:'/api/search',headers:{}},res);
  assert.equal(res.statusCode,405);
  assert.equal(res.headers['Cache-Control'],'no-store');
});

test('搜索参数必须是三类之一并校验长度',async()=>{
  const res=response();await handler({method:'GET',url:'/api/search?category=all&q=a',headers:{}},res);
  assert.equal(res.statusCode,400);
});

test('缺少 Supabase 配置，不允许绕过身份校验',async()=>{
  const res=response();await handler({method:'GET',url:'/api/search?category=anime&q=%E8%8A%99%E8%8E%89%E8%8E%B2',headers:{}},res);
  assert.ok([401,503].includes(res.statusCode));
  assert.equal(res.headers['Cache-Control'],'no-store');
});

test('Supabase 用户校验只接受 Auth /user 成功且有 id 的响应',async()=>{
  const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_key'};
  const fetcher=async(url,opts)=>{
    assert.equal(url,'https://project.supabase.co/auth/v1/user');
    assert.equal(opts.headers.Authorization,'Bearer token123');
    return {ok:true,json:async()=>({id:'123'})};
  };
  assert.equal(await verifySupabaseUser('token123',{fetcher,env}),'123');
  await assert.rejects(()=>verifySupabaseUser('',{fetcher,env}),e=>e.status===401);
  await assert.rejects(()=>verifySupabaseUser('token123',{fetcher:async()=>({ok:false,status:401}),env}),e=>e.status===401);
});

test('Vercel rejects invalid search page before hitting Supabase',async()=>{
  const res=response();await handler({method:'GET',url:'/api/search?category=anime&q=%E8%8A%99%E8%8E%89%E8%8E%B2&page=101',headers:{}},res);
  assert.equal(res.statusCode,400);
});
