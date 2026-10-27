import test from 'node:test';
import assert from 'node:assert/strict';
import {getCoverPath,fetchBangumiCover} from './cover.mjs';
const ok='/pic/cover/l/9d/d1/245665_5an54.jpg';
test('允许 Bangumi 官方封面路径及裁剪路径',()=>{
 assert.equal(getCoverPath(ok),ok);
 assert.equal(getCoverPath('/r/400/pic/cover/l/9d/d1/245665_5an54.jpg'),'/r/400/pic/cover/l/9d/d1/245665_5an54.jpg');
});
test('拦截外链、路径穿越、非封面 URL 和非图片后缀',()=>{
 for(const path of ['/etc/passwd','https://evil.test/x.jpg','//evil.test/x.jpg','/pic/cover/l/../private.jpg','/pic/user/l/9d/d1/a.jpg','/pic/cover/l/9d/d1/a.svg','/pic/cover/l/9d/d1/a.jpg?x=1'])assert.throws(()=>getCoverPath(path));
});
test('服务器请求固定目的域名，且限制 Content-Type',async()=>{
 let captured='';
 const fetcher=async(url,opts)=>{captured=url;return {ok:true,headers:new Headers({'content-type':'image/jpeg'}),body:(async function*(){yield new Uint8Array([1,2,3])})()}}
 const response=await fetchBangumiCover(ok,fetcher);
 assert.equal(captured,`https://lain.bgm.tv${ok}`);
 assert.equal(response.contentType,'image/jpeg');assert.equal(response.bytes.length,3);
 const html=async()=>({ok:true,headers:new Headers({'content-type':'text/html'}),body:(async function*(){yield new Uint8Array([1])})()});
 await assert.rejects(fetchBangumiCover(ok,html),/Unexpected content type/);
});
test('即使上游不传长度也限制最大二进制大小',async()=>{
 const fetcher=async()=>({ok:true,headers:new Headers({'content-type':'image/png'}),body:(async function*(){yield new Uint8Array(5*1024*1024+1)})()});
 await assert.rejects(fetchBangumiCover(ok,fetcher),/Cover too large/);
});
test('仅在显式启用时使用固定图床镜像',async()=>{
 const urls=[];
 const fetcher=async(url)=>{
   urls.push(url);
   if(url.startsWith('https://lain.bgm.tv'))throw new Error('network');
   return {ok:true,headers:new Headers({'content-type':'image/png'}),body:(async function*(){yield new Uint8Array([8])})()};
 };
 const result=await fetchBangumiCover(ok,fetcher,{BANGUMI_COVER_MIRROR:'1'});
 assert.equal(result.bytes.length,1);
 assert.deepEqual(urls,[`https://lain.bgm.tv${ok}`,`https://bgmimg.anibt.net${ok}`]);
});

import {getCoverSubjectId,fetchBangumiSubjectCover} from './cover.mjs';
test('旧版 Bangumi subject image 302 被安全跟随到图片代理',async()=>{
 const calls=[];
 const fetcher=async url=>{
   calls.push(url);
   if(url.includes('/v0/subjects/400602/image'))return {status:302,headers:new Headers({location:'https://lain.bgm.tv/pic/cover/l/9d/d1/245665_5an54.jpg'})};
   return {ok:true,headers:new Headers({'content-type':'image/jpeg'}),body:(async function*(){yield new Uint8Array([1,2])})()};
 };
 const result=await fetchBangumiSubjectCover('400602',fetcher,{});
 assert.equal(result.bytes.length,2);assert.equal(calls.length,2);
 assert.match(calls[1],/^https:\/\/lain\.bgm\.tv\//);
});
test('错误 subject、恶意跳转不会变成任意地址的代理',async()=>{
 for(const id of ['http://evil.test','0','1/../2',''])assert.throws(()=>getCoverSubjectId(id));
 const fetcher=async url=>{
   if(url.endsWith('image?type=large'))return {status:302,headers:new Headers({location:'https://evil.test/a.jpg'})};
   throw new Error('network');
 };
 await assert.rejects(fetchBangumiSubjectCover('400602',fetcher,{}),/unavailable/);
});
test('四张内置动画在 Bangumi 失联时可退回 MAL/Jikan 的严格图床代理',async()=>{
 const calls=[];
 const fetcher=async url=>{
   calls.push(url);
   if(url.startsWith('https://api.bgm.tv'))throw new Error('Bangumi unreachable');
   if(url==='https://api.jikan.moe/v4/anime/52991')return {ok:true,json:async()=>({data:{images:{jpg:{large_image_url:'https://cdn.myanimelist.net/images/anime/100/12345.jpg'}}}})};
   if(url==='https://cdn.myanimelist.net/images/anime/100/12345.jpg')return {ok:true,headers:new Headers({'content-type':'image/jpeg'}),body:(async function*(){yield new Uint8Array([9,8,7])})()};
   throw Error(`unexpected ${url}`);
 };
 const result=await fetchBangumiSubjectCover('400602',fetcher,{JIKAN_FALLBACK:'1'});
 assert.equal(result.bytes.length,3);
 assert.ok(calls.includes('https://api.jikan.moe/v4/anime/52991'));
});
