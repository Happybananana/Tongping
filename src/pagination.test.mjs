import test from 'node:test';import assert from 'node:assert/strict';import {paginate} from './pagination.js';
test('11 items in batches of 10',()=>{const values=Array.from({length:11},(_,i)=>i);const a=paginate(values,1,10),b=paginate(values,2,10);assert.deepEqual(a.items,values.slice(0,10));assert.deepEqual(b.items,[10]);assert.equal(b.hasNext,false)});
test('clamps stale page and handles empty results',()=>{assert.equal(paginate([1,2],99,10).page,1);const empty=paginate([],4,10);assert.equal(empty.page,1);assert.equal(empty.totalPages,1)});
test('invalid pages and sizes are safe',()=>{assert.equal(paginate([1],NaN,-1).page,1);assert.equal(paginate([1],-5,1).page,1)});
