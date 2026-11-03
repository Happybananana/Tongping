import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeTravelPois,parseAmapLocation} from './travelPlaces.mjs';
test('Amap longitude-latitude correctly normalized',()=>{
 assert.deepEqual(parseAmapLocation('120.143,30.239'),{longitude:120.143,latitude:30.239});
 assert.equal(parseAmapLocation('800,30'),null);
 assert.equal(parseAmapLocation('12,98'),null);
 assert.equal(parseAmapLocation(''),null);
 assert.equal(parseAmapLocation([120,30]),null);
});
test('POIs keep provider ID, admin region and geography',()=>{
 const results=normalizeTravelPois({pois:[{id:'B000',name:'杭州西湖',pname:'浙江省',cityname:'杭州市',adname:'西湖区',location:'120.145,30.238'}]});
 assert.equal(results[0].providerItemId,'B000');assert.equal(results[0].location.latitude,30.238);
 assert.match(results[0].subtitle,/杭州市/);
});
