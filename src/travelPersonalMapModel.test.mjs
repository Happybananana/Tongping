import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPersonalTravelMap} from './travelPersonalMapModel.js';

const person='me';
const location=(id,coords={})=>({id,category:'place',name:`地点${id}`,subtitle:'中国 · 示例',
  place_longitude:120.17,place_latitude:30.25,place_coordinate_system:'GCJ-02',...coords});
const rec=(id,extra={})=>({user_id:person,item_id:id,status:'done',visibility:'private',
  rating:8.8,note:'仅我可见的回忆',spoiler:false,visited_on:'2023-05-12',visit_date_precision:'day',...extra});

test('personal map includes my private completed trips without requiring sharing',()=>{
  const d=buildPersonalTravelMap([rec('a')],[location('a')],person);
  assert.equal(d.places.length,1);assert.equal(d.places[0].visits[0].visibility,'private');
  assert.equal(d.places[0].visits[0].note,'仅我可见的回忆');
  assert.deepEqual(d.participantIds,['me']);
});
test('personal map never accepts another user’s records or wish-list items',()=>{
  const d=buildPersonalTravelMap([rec('a',{user_id:'friend'}),rec('b',{status:'want'}),rec('c')],
    [location('a'),location('b'),location('c')],person);
  assert.deepEqual(d.places.map(x=>x.item_id),['c']);
});
test('missing coordinates stay in the archive and are not fabricated',()=>{
  const d=buildPersonalTravelMap([rec('a'),rec('b')],
    [location('a',{place_longitude:null}),location('b')],person);
  assert.equal(d.places.length,1);assert.equal(d.unmapped.length,1);
  assert.equal(d.unmapped[0].item_id,'a');
});
test('only clearly ordered trips can be connected; unknown or overlapping dates are separate',()=>{
  const rows=[rec('a',{visited_on:'2024-01-01',visit_date_precision:'year'}),
    rec('b',{visited_on:'2024-09-12'}),rec('c',{visited_on:'2025-01-06'})];
  const d=buildPersonalTravelMap(rows,[location('a'),location('b',{place_longitude:121}),location('c',{place_longitude:122})],person);
  assert.equal(d.segmentsById.me.length,1);
  assert.equal(d.segmentsById.me[0].fromPlace,'b');
  assert.equal(d.segmentsById.me[0].toPlace,'c');
});
test('personal map does not merge same-named places with different IDs',()=>{
  const d=buildPersonalTravelMap([rec('a'),rec('b')],[location('a'),location('b',{name:'地点a',place_longitude:121})],person);
  assert.equal(d.places.length,2);
});
test('unlocated and undated records never generate route segments',()=>{
  const d=buildPersonalTravelMap([rec('a',{visited_on:null}),rec('b',{visited_on:null}),rec('c')],
    [location('a'),location('b',{place_longitude:null}),location('c',{place_longitude:121})],person);
  assert.equal(d.segmentsById.me.length,0);
  assert.equal(d.unmapped.length,1);
});
test('model tolerates empty records and missing user IDs',()=>{
  assert.equal(buildPersonalTravelMap([],[],person).places.length,0);
  assert.equal(buildPersonalTravelMap([rec('a')],[location('a')],null).places.length,0);
});

test('station list puts most recently visited first, undated last',()=>{
  const d=buildPersonalTravelMap([rec('a',{visited_on:null}),rec('b',{visited_on:'2021-01-01'}),rec('c',{visited_on:'2025-01-01'})],
    [location('a'),location('b'),location('c')],person);
  assert.deepEqual(d.places.map(x=>x.item_id),['c','b','a']);
});
