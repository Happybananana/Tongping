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
