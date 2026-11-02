import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareImportRow,applyImportDecision,confirmImportCandidate,clearImportCandidate,
  toggleImportRow,canSelectImportRow,getImportLookupJobs,getImportSelectionSummary,
  shouldDefaultSelectImportRow
} from './importSelection.js';
const row=(fields={})=>({name:'游戏A',category:'game',match:null,remoteChoice:null,
  autoChosen:false,selected:true,lookupState:'queued',suggestions:[],error:'',...fields});
const candidate={name:'游戏A',category:'game',provider:'bangumi',providerId:'1'};

test('only matched shared-library rows are checked at file preview',()=>{
  const local=prepareImportRow(row({match:{id:'shared'}}));
  const remote=prepareImportRow(row());
  const invalid=prepareImportRow(row({match:{id:'shared'},error:'重复'}));
  assert.equal(local.selected,true);
  assert.equal(remote.selected,false);
  assert.equal(invalid.selected,false);
});
test('unselected rows are still queued for automatic remote lookup',()=>{
  const rows=[prepareImportRow(row()),prepareImportRow(row({lookupState:'queued'})),prepareImportRow(row({match:{id:'1'}})),row({error:'重复'})];
  assert.deepEqual(getImportLookupJobs(rows),[0,1]);
});
test('high-confidence auto selection and low-confidence unchecked',()=>{
  const confident=prepareImportRow(row());
  applyImportDecision(confident,{candidates:[candidate],choice:candidate,reason:'完全一致'});
  assert.equal(confident.selected,true);
  assert.equal(confident.autoChosen,true);
  const review=prepareImportRow(row());
  applyImportDecision(review,{candidates:[candidate],choice:null,reason:'同名版本'});
  assert.equal(review.selected,false);
  assert.equal(review.remoteChoice,null);
});
test('manual candidate confirmation automatically checks its row; clear unchecks it',()=>{
  const r=prepareImportRow(row());
  applyImportDecision(r,{candidates:[candidate],choice:null});
  assert.equal(canSelectImportRow(r),false);
  assert.equal(confirmImportCandidate(r,candidate),true);
  assert.equal(r.selected,true);
  assert.equal(r.manualConfirmed,true);
  assert.equal(shouldDefaultSelectImportRow(r),true);
  clearImportCandidate(r);
  assert.equal(r.selected,false);
  assert.equal(r.manualConfirmed,false);
});
test('no-results and errors remain unselected by default; manual creation requires opt in',()=>{
  const none=prepareImportRow(row());
  applyImportDecision(none,{candidates:[],choice:null});
  assert.equal(none.selected,false);
  assert.equal(toggleImportRow(none,true),false);
  assert.equal(none.selected,false);
  assert.equal(toggleImportRow(none,true,{allowManualCreation:true}),true);
  assert.equal(none.selected,true);
  const error=prepareImportRow(row({error:'无效评分'}));
  assert.equal(toggleImportRow(error,true,{allowManualCreation:true}),false);
  assert.equal(error.selected,false);
});
test('explicitly unchecking an auto-selected row survives late updates',()=>{
  const r=prepareImportRow(row());
  applyImportDecision(r,{candidates:[candidate],choice:candidate});
  toggleImportRow(r,false);
  applyImportDecision(r,{candidates:[candidate],choice:candidate});
  assert.equal(r.selected,false);
});
test('summary accurately separates selected, review, missing and failed',()=>{
  const local=prepareImportRow(row({match:{id:'1'}}));
  const auto=prepareImportRow(row());applyImportDecision(auto,{candidates:[candidate],choice:candidate});
  const review=prepareImportRow(row());applyImportDecision(review,{candidates:[candidate],choice:null});
  const manual=prepareImportRow(row());applyImportDecision(manual,{candidates:[candidate],choice:null});confirmImportCandidate(manual,candidate);
  const missing=prepareImportRow(row());applyImportDecision(missing,{candidates:[],choice:null});
  const failure=prepareImportRow(row({lookupState:'error'}));
  assert.deepEqual(getImportSelectionSummary([local,auto,review,manual,missing,failure]),{
    total:6,selected:3,local:1,auto:1,reviewed:1,manual:0,pendingReview:1,noResults:1,failed:1,finished:5,searchTotal:5,pending:0
  });
});
