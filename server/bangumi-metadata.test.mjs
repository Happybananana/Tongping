import test from 'node:test';
import assert from 'node:assert/strict';
import {bangumiTags,normalizeBangumiSubject} from './bangumi-metadata.mjs';
import {bangumiDetail} from './search.mjs';

test('Bangumi score/rating count/platform/tags are mapped separately',()=>{
  const item=normalizeBangumiSubject({id:123,type:2,name:'Japanese',name_cn:'中文',date:'2023-10-12',
    platform:'TV',rating:{score:8.76,total:12003,rank:123},tags:[{name:'奇幻',count:400},{name:'旅行',count:270}],meta_tags:['原创'],images:{large:'http://lain.bgm.tv/pic/cover/l/a.jpg'}},'anime');
  assert.equal(item.bangumiScore,8.76);assert.equal(item.bangumiRatingTotal,12003);
  assert.equal(item.bangumiRank,123);assert.equal(item.platform,'TV');
  assert.deepEqual(item.tags,['原创','奇幻','旅行']);assert.match(item.coverUrl,/^https:\/\/lain\.bgm\.tv/);
  assert.equal(item.name,'中文');
});
test('game platform and category validation',()=>{
  assert.equal(normalizeBangumiSubject({id:15,type:4,name:'test',platform:'PC',rating:{score:9}},'game').platform,'PC');
  assert.equal(normalizeBangumiSubject({id:15,type:2,name:'wrong'},'game'),null);
  assert.equal(normalizeBangumiSubject({id:0},'anime'),null);
  assert.deepEqual(bangumiTags({tags:[{name:'RPG',count:100},{name:'恐怖',count:30},{name:'RPG',count:2}],meta_tags:['独立']}),['独立','RPG','恐怖']);
});
test('invalid or missing scores remain null, never fabricated',()=>{
  const x=normalizeBangumiSubject({id:9,type:2,rating:{score:0,total:0},name:'未评分'},'anime');
  assert.equal(x.bangumiScore,null);assert.equal(x.bangumiRatingTotal,0);assert.equal(x.bangumiRank,null);
});
test('detail endpoint validates id and fetches one v0 subject',async()=>{
  let n=0;const fetcher=async(url)=>{n++;assert.match(url,/\/v0\/subjects\/400602$/);return {ok:true,json:async()=>({id:400602,type:2,name_cn:'葬送的芙莉莲',platform:'TV',rating:{score:8.7,total:20000}})}};
  const found=await bangumiDetail('anime','400602',fetcher,{BANGUMI_USER_AGENT:'test/0.4.5'});
  assert.equal(found.name,'葬送的芙莉莲');assert.equal(found.bangumiScore,8.7);assert.equal(n,1);
  await assert.rejects(()=>bangumiDetail('game','../../foo',fetcher,{}),/非法/);
});
