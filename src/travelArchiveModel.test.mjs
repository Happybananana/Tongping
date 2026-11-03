import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTravelDate,formatTravelDate,normalizeTravelRecord,buildTravelArchive,groupArchiveByYear,exactPlaceMatch} from './travelArchiveModel.js';
test('precision-aware dates never imply an unknown month/day',()=>{
  assert.deepEqual(normalizeTravelDate('year',2022),{visited_on:'2022-01-01',visit_date_precision:'year'});
  assert.equal(formatTravelDate('2022-01-01','year'),'2022 年');
  assert.equal(formatTravelDate('2022-10-01','month'),'2022 年 10 月');
  assert.equal(formatTravelDate(null,null),'日期未记');
  assert.deepEqual(normalizeTravelDate('unknown'),{visited_on:null,visit_date_precision:null});
  assert.throws(()=>normalizeTravelDate('day',2023,2,30),/无效/);
  assert.throws(()=>normalizeTravelDate('day',2027,1,1),/不能晚于今天/);
});
test('wishlist cannot accidentally receive a visited date or score',()=>{
 const r=normalizeTravelRecord({status:'want',rating:9.9,precision:'year',year:2020,visibility:'circle'});
 assert.deepEqual({rating:r.rating,visited_on:r.visited_on,visibility:r.visibility},{rating:null,visited_on:null,visibility:'circle'});
 assert.equal(normalizeTravelRecord({status:'done',rating:7.6,precision:'unknown'}).rating,7.6);
 assert.throws(()=>normalizeTravelRecord({status:'done',rating:7.66}),/一位小数/);
});
test('date sorting uses visit date, not record edit date; old data stays undated',()=>{
 const places=[{id:'a',category:'place',name:'京都'},{id:'b',category:'place',name:'上海'},{id:'c',category:'place',name:'北京'}];
 const records=[
 {item_id:'a',status:'done',visited_on:'2023-01-01',visit_date_precision:'year',updated_at:'2026-11-01'},
 {item_id:'b',status:'done',visited_on:'2025-07-01',visit_date_precision:'month',updated_at:'2025-08-01'},
 {item_id:'c',status:'done',visited_on:null,updated_at:'2026-11-02'}];
 const result=buildTravelArchive(records,places);
 assert.deepEqual(result.filtered.map(r=>r.item_id),['b','a','c']);
 assert.deepEqual(groupArchiveByYear(result.filtered).map(g=>g.year),['2025','2023','日期未记']);
 assert.deepEqual(buildTravelArchive(records,places,{year:'undated'}).filtered.map(r=>r.item_id),['c']);
});
test('same name is insufficient for a shared crossing',()=>{
 assert.equal(exactPlaceMatch({provider:'amap',provider_item_id:'AB'},{provider:'amap',provider_item_id:'AB'}),true);
 assert.equal(exactPlaceMatch({provider:'amap',provider_item_id:'AB'},{provider:'amap',provider_item_id:'XY'}),false);
 assert.equal(exactPlaceMatch({name:'西湖'},{name:'西湖'}),false);
});
