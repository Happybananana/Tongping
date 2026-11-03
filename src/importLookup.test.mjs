import test from 'node:test';
import assert from 'node:assert/strict';
import {posterScoreTone,rankImportCandidates,scoreImportCandidate,evaluateImportMatch} from './importLookup.js';
test('poster colors use the personal 0.5–10 scale',()=>{
  for(const [score,tone] of [[10,'positive'],[8,'positive'],[7.5,'mixed'],[7,'mixed'],[6.9,'negative'],[6,'negative'],[5.5,'negative'],[.5,'negative'],[null,'unrated'],['abc','unrated']])assert.equal(posterScoreTone(score),tone);
});
test('category and title are prerequisites for candidates',()=>{
  const row={name:'葬送的芙莉莲',subtitle:'Frieren',category:'anime',year:'2023'};
  const candidates=[{name:'不相关',category:'anime',provider:'bangumi',providerId:'1'}, {name:'葬送的芙莉莲',category:'game',provider:'bangumi',providerId:'2'}, {name:'葬送的芙莉莲',category:'anime',year:'2023',provider:'bangumi',providerId:'3'}, {name:'葬送的芙莉莲',category:'anime',year:'2010',provider:'bangumi',providerId:'4'}];
  assert.deepEqual(rankImportCandidates(row,candidates).map(x=>x.providerId),['3','4']);
  assert.equal(scoreImportCandidate(row,candidates[1]),-1);
});
test('deduplicate provider entries and discard unrelated titles',()=>{
  const row={name:'星露谷物语',category:'game'};
  assert.equal(rankImportCandidates(row,[{name:'银河战士',category:'game'}]).length,0);
  const c={name:'星露谷物语',category:'game',provider:'rawg',providerId:'9'};
  assert.equal(rankImportCandidates(row,[c,c]).length,1);
});
test('unique exact title and matching year is high confidence',()=>{
  const row={name:'葬送的芙莉莲',category:'anime',year:'2023'};
  const items=[{name:'葬送的芙莉莲',category:'anime',year:'2023',provider:'bangumi',providerId:'1'}, {name:'葬送的芙莉莲 第二季',category:'anime',year:'2026',provider:'bangumi',providerId:'2'}];
  const decision=evaluateImportMatch(row,items);assert.equal(decision.confidence,'high');assert.equal(decision.choice?.providerId,'1');
});
test('conflicting year, missing year, and multiple exact editions require review',()=>{
  const row={name:'游戏A',category:'game',year:'2014'};
  const mk=(id,year,provider='bangumi')=>({name:'游戏A',category:'game',year,provider,providerId:id});
  assert.equal(evaluateImportMatch(row,[mk('1','2020')]).choice,null);
  assert.equal(evaluateImportMatch(row,[mk('1','')]).choice,null);
  assert.equal(evaluateImportMatch(row,[mk('1','2014'),mk('2','2014')]).choice,null);
  assert.equal(evaluateImportMatch(row,[mk('1','2014'),mk('2','2017')]).choice?.providerId,'1');
  assert.equal(evaluateImportMatch({...row,year:''},[mk('1','2020'),mk('2','2014')]).choice,null);
});
test('same known Bangumi ID can resolve same-name variants unless year conflicts',()=>{
  const row={name:'作品A',category:'anime',year:'2020',providerId:'25'};
  const items=[{name:'作品A',category:'anime',year:'2020',provider:'bangumi',providerId:'25'}, {name:'作品A',category:'anime',year:'2020',provider:'bangumi',providerId:'26'}];
  assert.equal(evaluateImportMatch(row,items).choice?.providerId,'25');
  assert.equal(evaluateImportMatch(row,[{...items[0],year:'2025'}]).choice,null);
});
test('only a partial title is never silently approved',()=>{
  const row={name:'空洞骑士',category:'game'};
  const result=evaluateImportMatch(row,[{name:'空洞骑士：丝之歌',category:'game',provider:'bangumi'}]);
  assert.equal(result.choice,null);assert.equal(result.candidates.length,1);
});

test('different editions with no provider ID still remain ambiguous',()=>{
  const row={name:'同名游戏',category:'game'};
  const results=[{name:'同名游戏',category:'game',provider:'rawg',year:'2019'},{name:'同名游戏',category:'game',provider:'rawg',year:'2023'}];
  assert.equal(evaluateImportMatch(row,results).choice,null);
});
