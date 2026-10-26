import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './cover.js';
const mock=(method,query)=>({method,query});
function resp(){const r={code:200,headers:{},body:null};r.setHeader=(k,v)=>{r.headers[k]=v;return r};r.status=v=>{r.code=v;return r};r.end=b=>{r.body=b;return r};return r}
test('不允许 POST 图片接口',async()=>{const r=resp();await handler(mock('POST',{path:'/pic/cover/l/9d/d1/245665_5an54.jpg'}),r);assert.equal(r.code,405)});
test('拒绝把接口当成开放代理',async()=>{const r=resp();await handler(mock('GET',{path:'https://example.com/private'}),r);assert.equal(r.code,400)});
