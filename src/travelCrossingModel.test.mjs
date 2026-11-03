import test from 'node:test';
import assert from 'node:assert/strict';
import {gcjToWgs84,mapPoint,buildTravelCrossings,chronologicallyCertainSegments,initialViewport,zoomViewport} from './travelCrossingModel.js';
const record=(id,person,details={})=>({traveler_id:person,item_id:id,place_name:'地点'+id,
  place_subtitle:'中国 · 示例',longitude:120.17,latitude:30.25,coordinate_system:'GCJ-02',
  visited_on:'2025-04-12',visit_date_precision:'day',status:'done',visibility:'circle',rating:8.5,note:'回忆',...details});

test('only exact shared catalog IDs count as intersections',()=>{
  const m=record('a','me');const f=record('a','friend',{rating:9.5});
  const ambiguous=record('b','friend',{place_name:'地点a'});
  const data=buildTravelCrossings([m,f,ambiguous], 'me','friend');
  assert.equal(data.crossings.length,1);assert.equal(data.crossings[0].item_id,'a');
  assert.equal(data.crossings[0].sameDay,true);
  assert.equal(data.own.length,1);assert.equal(data.friend.length,2);
});
test('private, want, unknown coordinates and third-party records are never mapped',()=>{
  const rows=[record('a','me'),record('a','friend',{visibility:'private'}),
    record('b','friend',{status:'want'}),record('c','friend',{longitude:null}),record('d','third')];
  const d=buildTravelCrossings(rows,'me','friend');
  assert.equal(d.own.length,1);assert.equal(d.friend.length,0);assert.equal(d.crossings.length,0);
});
test('year-only dates do not manufacture a within-year route order',()=>{
  const a=record('a','me',{visited_on:'2025-01-01',visit_date_precision:'year'});
  const b=record('b','me',{longitude:121,visited_on:'2025-08-02',visit_date_precision:'day'});
  assert.equal(chronologicallyCertainSegments([a,b]).length,0);
  const c=record('c','me',{longitude:122,visited_on:'2026-01-01',visit_date_precision:'year'});
  const segments=chronologicallyCertainSegments([a,c]);assert.equal(segments.length,1);
  assert.equal(segments[0].fromPlace,'a');
});
test('GCJ-02 China rendering conversion is approximate and leaves overseas unaffected',()=>{
  const beijing=gcjToWgs84(116.404,39.915);
  assert.ok(Math.abs(beijing.longitude-116.398)<.005);
  const kyoto=gcjToWgs84(135.7681,35.0116);
  assert.equal(kyoto.longitude,135.7681);
  const point=mapPoint(record('a','me'));
  assert.ok(point.x>800&&point.x<900);assert.ok(point.y>150&&point.y<180);
});
test('viewport bounds and zoom remain within map extents',()=>{
  const d=buildTravelCrossings([record('a','me')],'me','friend');
  const v=initialViewport(d.places),z=zoomViewport(v,.5);
  assert.ok(v.w>=95);assert.ok(z.w<v.w);assert.ok(z.x>=0&&z.y>=0);
  assert.ok(z.x+z.w<=1000&&z.y+z.h<=500);
});

const groupRecord=(id,traveler,details={})=>record(id,traveler,details);
test('group mode supports at most four unique people including me',async()=>{
  const {buildGroupTravelCrossings}=await import('./travelCrossingModel.js');
  const rows=['me','f1','f2','f3','f4'].map(id=>groupRecord('kyoto',id));
  const d=buildGroupTravelCrossings(rows,['me','f1','f2','f3','f4','me']);
  assert.deepEqual(d.participantIds,['me','f1','f2','f3']);
  assert.equal(d.crossings.length,1);
  assert.equal(d.crossings[0].count,4);
  assert.equal(Object.keys(d.tracksById).length,4);
});
test('group shared stations count exact common catalog ID and support 2/3/4 filters',async()=>{
  const {buildGroupTravelCrossings}=await import('./travelCrossingModel.js');
  const rows=[groupRecord('a','me'),groupRecord('a','f1'),groupRecord('a','f2'),groupRecord('a','f3'),
    groupRecord('b','me'),groupRecord('b','f2'),groupRecord('b','f3'),
    groupRecord('c','me'),groupRecord('c','f3'),groupRecord('d','f1')];
  const d=buildGroupTravelCrossings(rows,['me','f1','f2','f3']);
  assert.deepEqual(d.places.filter(p=>p.count>=2).map(p=>p.item_id).sort(),['a','b','c']);
  assert.deepEqual(d.places.filter(p=>p.count>=3).map(p=>p.item_id).sort(),['a','b']);
  assert.deepEqual(d.places.filter(p=>p.count>=4).map(p=>p.item_id),['a']);
  assert.equal(d.places.find(p=>p.item_id==='d').count,1);
});
test('group excludes private, wishlist, missing coordinates and unselected people',async()=>{
  const {buildGroupTravelCrossings}=await import('./travelCrossingModel.js');
  const d=buildGroupTravelCrossings([groupRecord('a','me'),
    groupRecord('a','f1',{visibility:'private'}),groupRecord('a','f2',{status:'want'}),
    groupRecord('a','f3',{longitude:null}),groupRecord('a','not-selected')],['me','f1','f2','f3']);
  assert.equal(d.places[0].count,1);assert.equal(d.crossings.length,0);
});
test('group same-day label is true only when all records at that station are date-precise',async()=>{
  const {buildGroupTravelCrossings}=await import('./travelCrossingModel.js');
  const d=buildGroupTravelCrossings([groupRecord('a','me'),groupRecord('a','f1'),
    groupRecord('a','f2',{visit_date_precision:'year',visited_on:'2025-01-01'})],['me','f1','f2']);
  assert.equal(d.places[0].sameDay,false);assert.equal(d.places[0].sameYear,true);
});
