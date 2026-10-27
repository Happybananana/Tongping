import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './subject.js';
function response(){return {statusCode:0,headers:{},payload:null,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(obj){this.payload=obj;return this}}}
test('subject route rejects other methods',async()=>{
 const res=response();await handler({method:'POST',url:'/api/subject',headers:{}},res);
 assert.equal(res.statusCode,405);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('subject route rejects arbitrary/SSRF ids and categories before auth',async()=>{
 const res=response();await handler({method:'GET',url:'/api/subject?category=all&id=http://evil',headers:{}},res);assert.equal(res.statusCode,400);
});
test('subject route rejects unauthenticated access',async()=>{
 const res=response();await handler({method:'GET',url:'/api/subject?category=anime&id=400602',headers:{}},res);assert.ok([401,503].includes(res.statusCode));
});
