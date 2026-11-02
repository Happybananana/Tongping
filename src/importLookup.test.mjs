import test from 'node:test';
import assert from 'node:assert/strict';
import {posterScoreTone,rankImportCandidates,scoreImportCandidate} from './importLookup.js';
test('poster colors are based on personal 0.5–10 scores',()=>{
  for(const [score,tone] of [[10,'positive'],[8,'positive'],[7.5,'mixed'],[6,'mixed'],[5.5,'negative'],[.5,'negative'],[null,'unrated'],['abc','unrated']])assert.equal(posterScoreTone(score),tone);
});
test('match candidates by same category and name, but never auto approve',()=>{
  const row={name:'葬送的芙莉莲',subtitle:'Frieren',category:'anime',year:'2023'};
  const candidates=[{name:'不相关',category:'anime',provider:'bangumi',providerId:'1'}, {name:'葬送的芙莉莲',category:'game',provider:'bangumi',providerId:'2'}, {name:'葬送的芙莉莲',category:'anime',year:'2023',provider:'bangumi',providerId:'3'}, {name:'葬送的芙莉莲',category:'anime',year:'2010',provider:'bangumi',providerId:'4'}];
  assert.deepEqual(rankImportCandidates(row,candidates).map(x=>x.providerId),['3','4']);
  assert.equal(scoreImportCandidate(row,candidates[1]),-1);
});
test('same provider duplicate is removed and very fuzzy titles excluded',()=>{
  const row={name:'星露谷物语',category:'game'};
  assert.equal(rankImportCandidates(row,[{name:'银河战士',category:'game'}]).length,0);
  const c={name:'星露谷物语',category:'game',provider:'rawg',providerId:'9'};
  assert.equal(rankImportCandidates(row,[c,c]).length,1);
});
