import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMediaCover,fetchMediaCover} from './media-cover.mjs';
test('Strictly allowlisted image paths only; rejects external URLs and traversal',()=>{
 assert.equal(parseMediaCover('mal','/images/anime/100/12345.jpg'),'https://cdn.myanimelist.net/images/anime/100/12345.jpg');
 assert.equal(parseMediaCover('steam','/store_item_assets/steam/apps/1245620/library_600x900.jpg'),'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/library_600x900.jpg');
 for(const value of ['https://evil.test/x.jpg','//evil.test/x.jpg','/images/anime/../passwd','/images/anime/100/fail.svg'])assert.throws(()=>parseMediaCover('mal',value));
 assert.throws(()=>parseMediaCover('evil','/images/anime/100/1.jpg'));
});
test('Proxy enforces content type and byte cap',async()=>{
 const f=async()=>({ok:true,headers:new Headers({'content-type':'image/jpeg'}),body:(async function*(){yield new Uint8Array([1,2,3])})()});
 const r=await fetchMediaCover('mal','/images/anime/100/12345.jpg',f);assert.equal(r.bytes.length,3);
 await assert.rejects(fetchMediaCover('mal','/images/anime/100/12345.jpg',async()=>({ok:true,headers:new Headers({'content-type':'image/png','content-length':6*1024*1024})})),/too large/);
});
