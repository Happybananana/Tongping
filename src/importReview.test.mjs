import test from 'node:test';
import assert from 'node:assert/strict';
import {importReviewBucket,orderedImportRowIndices} from './importSelection.js';

test('review bucket distinguishes ambiguous / confirmed / exhausted / searching',()=>{
  assert.equal(importReviewBucket({lookupState:'done',suggestions:[{id:1}]}),'review');
  assert.equal(importReviewBucket({lookupState:'done',suggestions:[{id:1}],remoteChoice:{id:1}}),'matched');
  assert.equal(importReviewBucket({match:{id:'local'}}),'matched');
  assert.equal(importReviewBucket({lookupState:'done',suggestions:[] }),'missing');
  assert.equal(importReviewBucket({lookupState:'error'}),'missing');
  assert.equal(importReviewBucket({lookupState:'queued'}),'searching');
  assert.equal(importReviewBucket({error:'重复'}),'invalid');
});
test('import review priority is review -> searching -> matched -> missing -> invalid',()=>{
  const rows=[
    {lookupState:'done',suggestions:[]},
    {match:{id:5}},
    {lookupState:'done',suggestions:[{id:4}]},
    {error:'invalid'},
    {lookupState:'queued'},
    {lookupState:'done',suggestions:[{id:6}]},
  ];
  assert.deepEqual(orderedImportRowIndices(rows),[2,5,4,1,0,3]);
});
