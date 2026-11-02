import test from 'node:test';import assert from 'node:assert/strict';
import {findPostSubjects} from './postSearch.js';
const items=[{id:'a',category:'anime',name:'葬送的芙莉莲',subtitle:'Frieren'},{id:'b',category:'game',name:'女神异闻录4',subtitle:'Persona 4'},{id:'c',category:'place',name:'京都',subtitle:'Japan'}];
test('post selector searches Chinese and English aliases',()=>{assert.equal(findPostSubjects(items,'芙莉莲')[0].id,'a');assert.equal(findPostSubjects(items,'persona4')[0].id,'b')});
test('place not listed and no random selection',()=>{assert.deepEqual(findPostSubjects(items,'京都'),[]);assert.equal(findPostSubjects(items,'').length,2)});
test('result limit respected',()=>assert.equal(findPostSubjects([...items,...items],'',1).length,1));
