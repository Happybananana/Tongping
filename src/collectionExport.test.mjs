import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPORT_HEADERS,buildCollectionExportRows,collectionToCsv,collectionToXlsx} from './collectionExport.js';
import {parseCsv,parseImportRows} from './sheetImport.js';
const items=[
  {id:'a',category:'anime',name:'葬送的芙莉莲',subtitle:'Frieren',year:'2023',provider:'bangumi',providerItemId:'400602',coverUrl:'https://example.test/img1.jpg'},
  {id:'g',category:'game',name:'艾尔登法环',year:'2022',provider:'igdb',providerItemId:'17'},
  {id:'p',category:'place',name:'东京',year:'2025'},
];
const records=[
  {userId:'me',itemId:'a',rating:9.5,status:'done',note:'非常好看\n二刷',visibility:'private',updatedAt:'2026-11-01T03:00:00Z',spoiler:false},
  {userId:'me',itemId:'g',rating:null,status:'want',note:'先收藏',visibility:'circle',updatedAt:'2026-10-03T03:00:00Z'},
  {userId:'friend',itemId:'g',rating:1.5,status:'done',note:'私人评论',visibility:'private'},
  {userId:'me',itemId:'p',rating:8,status:'done',note:'旅行',visibility:'private'}
];
const rows=buildCollectionExportRows({items,records,userId:'me'});
test('export only current user anime/game; exclude friend and separate travel',()=>{
 assert.equal(rows.length,2);assert.equal(rows[0][0],'葬送的芙莉莲');assert.equal(rows[0][2],9.5);
 assert.equal(rows[0][7],'400602');assert.equal(rows[1][2],'');assert.equal(rows[1][3],'想玩');
 assert.ok(!JSON.stringify(rows).includes('私人评论'));
});
test('Excel/CSV export starts with import-compatible headers and roundtrips scores/status',()=>{
 const csv=collectionToCsv(rows);assert.ok(csv.startsWith('\uFEFF'));const grid=parseCsv(csv);
 assert.deepEqual(grid[0],EXPORT_HEADERS);const imported=parseImportRows(grid);
 assert.equal(imported.rows[0].category,'anime');assert.equal(imported.rows[0].rating,9.5);assert.equal(imported.rows[0].status,'done');
 assert.equal(imported.rows[1].category,'game');assert.equal(imported.rows[1].rating,null);assert.equal(imported.rows[1].status,'want');
 assert.equal(imported.rows[0].note,'非常好看\n二刷');
});
test('CSV neutralizes spreadsheet formulas in untrusted title and remarks',()=>{
 const suspicious=buildCollectionExportRows({items:[{id:'x',category:'anime',name:'=HYPERLINK("https://bad.invalid")'}],records:[{userId:'me',itemId:'x',rating:null,status:'want',note:'\t=cmd|evil',updatedAt:''}],userId:'me'});
 const csv=collectionToCsv(suspicious);const parsed=parseCsv(csv);
 assert.ok(parsed[1][0].startsWith("'="));assert.ok(parsed[1][4].startsWith("'\t="));
});
test('XLSX container has ZIP signature, is non-empty, and keeps explicit string cells',async()=>{
 const blob=collectionToXlsx(rows);const buf=new Uint8Array(await blob.arrayBuffer());
 assert.equal(buf[0],0x50);assert.equal(buf[1],0x4b);assert.ok(buf.length>4000);
 const raw=new TextDecoder().decode(buf);assert.ok(raw.includes('name="收藏数据"'));assert.ok(raw.includes('t="inlineStr"'));
 assert.ok(raw.includes('葬送的芙莉莲'));assert.ok(raw.includes('使用说明'));
});
test('export does not require a server but requires a user ID',()=>{
 assert.throws(()=>buildCollectionExportRows({items,records}),/当前用户/);
});
test('dedicated Supabase export paginates and never fetches friends experiences',async()=>{
  const {loadCollectionForExport}=await import('./collectionExport.js');
  const own=Array.from({length:5},(_,i)=>({id:`r${i}`,user_id:'me',item_id:i%2?'g':'a',rating:8.5,status:'done',note:'',visibility:'private',updated_at:`2026-11-0${i+1}T00:00:00Z`}));
  const allItems=[{id:'a',category:'anime',name:'动画作品'},{id:'g',category:'game',name:'游戏作品'}];
  let scopes=[];
  const db={from(table){
    if(table==='experiences')return {select(){return this},eq(key,val){scopes.push([key,val]);return this},order(){return this},async range(a,b){return {data:own.slice(a,b+1),error:null}}};
    if(table==='catalog_items')return {select(){return this},async in(key,ids){return {data:allItems.filter(i=>ids.includes(i.id)),error:null}}};
    throw Error('unexpected table');
  }};
  const snapshot=await loadCollectionForExport(db,'me',{pageSize:2});
  assert.equal(snapshot.records.length,5);assert.equal(snapshot.items.length,2);
  assert.ok(scopes.length>=3);assert.ok(scopes.every(([key,id])=>key==='user_id'&&id==='me'));
  assert.equal(buildCollectionExportRows({...snapshot,userId:'me'}).length,5);
});
test('partial/unreadable catalogue never creates a misleading complete export',async()=>{
  const {loadCollectionForExport}=await import('./collectionExport.js');
  const db={from(table){
    if(table==='experiences')return {select(){return this},eq(){return this},order(){return this},async range(){return {data:[{user_id:'me',item_id:'invisible'}],error:null}}};
    return {select(){return this},async in(){return {data:[],error:null}}};
  }};
  await assert.rejects(loadCollectionForExport(db,'me'),/作品资料无法读取/);
});


test('export preserves 0.1-increment decimal ratings through CSV import',()=>{
  const rows=buildCollectionExportRows({items:[{id:'x',category:'game',name:'示例游戏'}],
    records:[{userId:'me',itemId:'x',rating:7.6,status:'done',note:'',updatedAt:'2026-11-03'}],userId:'me'});
  assert.equal(rows[0][2],7.6);
  const imported=parseImportRows(parseCsv(collectionToCsv(rows)));
  assert.equal(imported.rows[0].rating,7.6);
});
