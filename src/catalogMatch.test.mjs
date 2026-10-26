import test from 'node:test';
import assert from 'node:assert/strict';
import {findExistingCatalogItem} from './catalogMatch.js';

test('不同城市同名景点不会因名称相同而被错误合并',()=>{
 const existing=[{id:'hangzhou',category:'place',name:'人民公园',subtitle:'浙江省 · 杭州市',provider:'amap',providerItemId:'hz-id'}];
 const other={category:'place',name:'人民公园',subtitle:'四川省 · 成都市',provider:'amap',providerId:'cd-id'};
 assert.equal(findExistingCatalogItem(existing,other),null);
 assert.equal(findExistingCatalogItem(existing,{...other,providerId:'hz-id'}).id,'hangzhou');
});
test('沿用 V0.3 精选条目以保留已有评分',()=>{
 const existing=[{id:'legacy',category:'anime',name:'葬送的芙莉莲',subtitle:'Frieren',provider:'demo',providerItemId:'a1'}];
 assert.equal(findExistingCatalogItem(existing,{category:'anime',name:'葬送的芙莉莲',provider:'bangumi',providerId:'400602'}).id,'legacy');
});
