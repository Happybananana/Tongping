import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSearch,normalizeBangumi,normalizeIGDB,normalizeAmap,searchCatalog} from './search.mjs';

test('搜索入参校验与长度保护',()=>{
 assert.equal(validateSearch('anime',' 芙莉莲 '),'芙莉莲');
 assert.throws(()=>validateSearch('all','芙莉莲'),/类别/);
 assert.throws(()=>validateSearch('game','x'),/2–65/);
 assert.throws(()=>validateSearch('place','x'.repeat(66)),/2–65/);
});
test('Bangumi 搜索结果映射并固定来源 ID',()=>{
 const rows=normalizeBangumi({data:[{id:400602,name:'葬送のフリーレン',name_cn:'葬送的芙莉莲',date:'2023-09-29',summary:'简介',images:{large:'https://img.example/a.jpg'}}]},'anime');
 assert.equal(rows[0].category,'anime');assert.equal(rows[0].name,'葬送的芙莉莲');
 assert.equal(rows[0].providerId,'400602');assert.match(rows[0].sourceUrl,/400602/);
});
test('IGDB 搜索结果映射并禁用非 HTTPS 链接',()=>{
 const rows=normalizeIGDB([{id:123,name:'Hollow Knight',url:'javascript:bad',cover:{image_id:'xyz'}}]);
 assert.equal(rows[0].sourceUrl,'');assert.match(rows[0].coverUrl,/xyz/);
});
test('高德结果映射保留地点 ID 和行政区',()=>{
 const rows=normalizeAmap({pois:[{id:'B0001',name:'西湖',pname:'浙江省',cityname:'杭州市',adname:'西湖区'}]});
 assert.equal(rows[0].category,'place');assert.equal(rows[0].providerId,'B0001');assert.match(rows[0].subtitle,/杭州市/);
});
test('Bangumi 搜索请求为 v0 POST，未配置 IGDB 可以完成游戏搜索',async()=>{
 const req=[];const fetcher=async (url,opts)=>{req.push({url,opts});return {ok:true,json:async()=>({data:[{id:7,name:'测试游戏'}]})}};
 const result=await searchCatalog('game','测试游戏',{fetcher,env:{BANGUMI_USER_AGENT:'example/Tongpin/0.4'}});
 assert.equal(result.items.length,1);assert.equal(result.items[0].provider,'bangumi');
 assert.match(req[0].url,/v0\/search\/subjects/);
 assert.equal(JSON.parse(req[0].opts.body).filter.type[0],4);
 assert.ok(result.notices.some(x=>x.includes('IGDB')));
});
test('外部接口失败不破坏共享库：响应空结果和可见提示',async()=>{
 const fetcher=async()=>{throw new Error('timeout')};
 const result=await searchCatalog('anime','模糊测试',{fetcher,env:{}});
 assert.deepEqual(result.items,[]);assert.match(result.notices.join(','),/暂时不可用/);
});
test('同一个瞬间的两次搜索在暖实例内共用一次请求',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,30));return {ok:true,json:async()=>({data:[{id:911,name:'并发去重测试'}]})}};
 const opts={fetcher,env:{BANGUMI_USER_AGENT:'test/Tongpin/0.4.4'}};
 const [a,b]=await Promise.all([searchCatalog('anime','并发去重测试',opts),searchCatalog('anime','并发去重测试',opts)]);
 assert.equal(calls,1);assert.deepEqual(a.items,b.items);
});

test('Online pagination has bounded page numbers and Bangumi offset',async()=>{
  const {validatePage,bangumiSearch,amapSearch}=await import('./search.mjs');
  assert.equal(validatePage('2'),2);
  for(const n of [0,-1,1.5,101,'abc']) assert.throws(()=>validatePage(n),e=>e.status===400);
  const bangumiCalls=[];
  await bangumiSearch('anime','新番检索',(url,opts)=>{bangumiCalls.push(url);return Promise.resolve({ok:true,json:async()=>({data:[]})});},{BANGUMI_USER_AGENT:'test'},2);
  assert.match(bangumiCalls[0],/offset=14/);
  let amapURL='';
  await amapSearch('杭州',(url)=>{amapURL=url;return Promise.resolve({ok:true,json:async()=>({status:'1',pois:[]})});},{AMAP_WEB_KEY:'test'},3);
  assert.match(amapURL,/page_num=3/);
});
