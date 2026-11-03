import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAfterMs,createImportPacer,searchImportWithRetry,isTemporaryEmptySearch,abortableWait,IMPORT_SEARCH_INTERVAL_MS} from './importSearchScheduler.js';
const resp=(status,payload,headers={})=>({status,ok:status>=200&&status<300,json:async()=>payload,headers:{get:name=>headers[name]||null}});
function virtual(){let t=1000;const waits=[];return {now:()=>t,wait:async(ms)=>{waits.push(ms);t+=ms},get time(){return t},waits};}

test('Retry-After parses seconds or HTTP date with a bounded delay',()=>{
 assert.equal(retryAfterMs('59'),59000);
 assert.equal(retryAfterMs('1000'),90000);
 assert.equal(retryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT',Date.parse('Wed, 21 Oct 2015 07:27:00 GMT')),60000);
 assert.equal(retryAfterMs('oops'),0);
});
test('pacer limits consecutive launch intervals under per-user 30/min budget',async()=>{
 const v=virtual(),pacer=createImportPacer({now:v.now,wait:v.wait});
 const launches=[];for(let i=0;i<35;i++){assert.equal(await pacer.takeTurn(),true);launches.push(v.time)}
 for(let i=1;i<launches.length;i++)assert.ok(launches[i]-launches[i-1]>=IMPORT_SEARCH_INTERVAL_MS);
 assert.ok(launches.filter(t=>t-launches[0]<60000).length<=18);
});
test('a 429 pauses the entire pacer and retries without losing the row',async()=>{
 const v=virtual(),pacer=createImportPacer({now:v.now,wait:v.wait});
 let calls=0;const updates=[];
 const outcome=await searchImportWithRetry({pacer,wait:v.wait,onRetry:x=>updates.push(x),request:async()=>{calls++;return calls===1?resp(429,{error:'rate limited'},{'Retry-After':'45'}):resp(200,{items:[{name:'Game'}]})}});
 assert.equal(outcome.kind,'ok');assert.equal(outcome.attempts,2);assert.equal(calls,2);
 assert.ok(v.time>=46000);assert.equal(updates[0].status,429);
});
test('temporary 200 empty and transient 502 retry, real zero results do not',async()=>{
 const v=virtual(),pacer=createImportPacer({now:v.now,wait:v.wait});let calls=0;
 const sequence=[resp(200,{items:[],temporaryFailure:true}),resp(502,{error:'upstream gateway'}),resp(200,{items:[{name:'Anime'}],temporaryFailure:false})];
 const found=await searchImportWithRetry({pacer,wait:v.wait,request:async()=>sequence[calls++]});
 assert.equal(found.kind,'ok');assert.equal(found.attempts,3);
 let noResultCalls=0;
 const empty=await searchImportWithRetry({pacer,wait:v.wait,request:async()=>{noResultCalls++;return resp(200,{items:[],temporaryFailure:false,notices:['Bangumi 暂时不可用']})}});
 assert.equal(empty.kind,'ok');assert.equal(noResultCalls,1);
});
test('permanent auth 401 is not retried',async()=>{
 const v=virtual(),pacer=createImportPacer({now:v.now,wait:v.wait});let calls=0;
 const result=await searchImportWithRetry({pacer,wait:v.wait,request:async()=>{calls++;return resp(401,{error:'请登录'})}});
 assert.equal(result.kind,'error');assert.equal(result.retryable,false);assert.equal(calls,1);
});
test('after three temporary failures row reports error for manual retry',async()=>{
 const v=virtual(),pacer=createImportPacer({now:v.now,wait:v.wait});let calls=0;
 const result=await searchImportWithRetry({pacer,wait:v.wait,request:async()=>{calls++;throw new TypeError('network disconnected')}});
 assert.equal(result.kind,'error');assert.equal(result.retryable,true);assert.equal(calls,3);
});
test('pause stops before a new attempt; abort cancels waits',async()=>{
 const v=virtual(),pacer=createImportPacer({now:v.now,wait:v.wait});
 let called=0;
 const outcome=await searchImportWithRetry({pacer,paused:()=>true,request:async()=>{called++;return resp(200,{items:[]})}});
 assert.equal(outcome.kind,'paused');assert.equal(called,0);
 const controller=new AbortController();
 const sleeper=abortableWait(10000,controller.signal);controller.abort();
 await assert.rejects(sleeper);
});
test('older deployed server temporary empty notices still cause retry',()=>{
 assert.equal(isTemporaryEmptySearch({items:[],notices:['Bangumi 暂时不可用']}),true);
 assert.equal(isTemporaryEmptySearch({error:'unstructured result'}),true);
 assert.equal(isTemporaryEmptySearch({items:[],temporaryFailure:false,notices:['Bangumi 暂时不可用']}),false);
 assert.equal(isTemporaryEmptySearch({items:[{id:1}],temporaryFailure:true}),false);
});
