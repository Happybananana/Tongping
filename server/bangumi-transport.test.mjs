import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBangumiBases,createBangumiTransport} from './bangumi-transport.mjs';

const response=(payload,status=200)=>({ok:status>=200&&status<300,status,json:async()=>payload});

test('官方域名为默认值，显式配置多个域名时去重并拒绝非 HTTPS',()=>{
 assert.deepEqual(parseBangumiBases({}),['https://api.bgm.tv']);
 assert.deepEqual(parseBangumiBases({BANGUMI_API_BASES:'http://evil.test,https://api.bgm.tv,https://api.bgm.tv,https://bgmapi.anibt.net'}),['https://api.bgm.tv','https://bgmapi.anibt.net']);
});

test('官方快速成功时，不调用镜像且解析响应数据',async()=>{
 const urls=[];const fetcher=async(url)=>{urls.push(url);return response({data:[{id:1}]});};
 const client=createBangumiTransport({fetcher,env:{BANGUMI_API_BASES:'https://api.bgm.tv,https://bgmapi.anibt.net'},hedgeMs:20});
 const result=await client.request('/v0/search/subjects?limit=14',{method:'POST',body:'{}'});
 assert.equal(result.data[0].id,1);assert.equal(urls.length,1);
});

test('官方抛错后立刻尝试备用域名，成功响应优先',async()=>{
 const urls=[]; const fetcher=async(url)=>{urls.push(url);if(url.includes('api.bgm.tv'))throw new Error('network');return response({ok:true});};
 const client=createBangumiTransport({fetcher,env:{BANGUMI_API_BASES:'https://api.bgm.tv,https://bgmapi.anibt.net'},hedgeMs:3000});
 const result=await client.request('/v0/search/subjects?limit=14');
 assert.deepEqual(result,{ok:true});assert.equal(urls.length,2);
});

test('慢的官方域名被对冲请求绕过',async()=>{
 const urls=[]; const fetcher=async(url)=>{urls.push(url);if(url.includes('api.bgm.tv'))await new Promise(resolve=>setTimeout(resolve,80));return response({host:url.includes('anibt')?'mirror':'official'});};
 const client=createBangumiTransport({fetcher,env:{BANGUMI_API_BASES:'https://api.bgm.tv,https://bgmapi.anibt.net'},hedgeMs:10});
 const result=await client.request('/v0/subjects/1');
 assert.equal(result.host,'mirror');assert.equal(urls.length,2);
});

test('失败域名进入冷却而被后续请求跳过',async()=>{
 const urls=[];
 const fetcher=async(url)=>{urls.push(url);if(url.includes('api.bgm.tv'))throw Error('network');return response({works:true})};
 const client=createBangumiTransport({fetcher,env:{BANGUMI_API_BASES:'https://api.bgm.tv,https://bgmapi.anibt.net'},hedgeMs:100});
 await client.request('/v0/subjects/1');
 await client.request('/v0/subjects/2');
 assert.equal(urls.filter(x=>x.includes('api.bgm.tv')).length,1);
});

test('不允许任意外部路径和未知端点',async()=>{
 const client=createBangumiTransport({fetcher:async()=>response({})});
 await assert.rejects(client.request('https://example.com'),/Unsupported/);
 await assert.rejects(client.request('/auth/v1/admin'),/Unsupported/);
});
