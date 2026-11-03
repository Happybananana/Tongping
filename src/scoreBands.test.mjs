import test from 'node:test';
import assert from 'node:assert/strict';
import {isValidPersonalRating,posterScoreTone,posterScoreTier,posterScoreLabel} from './scoreBands.js';

test('new score boundaries are inclusive on the lower bound', () => {
  const cases = [
    [0.5,'negative','red'],[6.9,'negative','red'],
    [7,'mixed','yellow'],[7.6,'mixed','yellow'],[7.9,'mixed','yellow'],
    [8,'positive','green-80'],[8.4,'positive','green-80'],
    [8.5,'positive','green-85'],[8.9,'positive','green-85'],
    [9,'positive','green-90'],[9.4,'positive','green-90'],
    [9.5,'positive','green-95'],[9.9,'positive','green-95'],[10,'positive','green-95']
  ];
  for (const [value,tone,tier] of cases) {
    assert.equal(posterScoreTone(value),tone,String(value));
    assert.equal(posterScoreTier(value),tier,String(value));
  }
});

test('one decimal place is accepted, but invalid precision and range are rejected', () => {
  for (const n of [0.5,1,7.6,8.3,8.7,9.7,10]) assert.equal(isValidPersonalRating(n),true,String(n));
  for (const n of [null,undefined,'',0,0.4,10.1,8.35,7.61,NaN,Infinity,'7.6'])
    assert.equal(isValidPersonalRating(n),false,String(n));
  assert.equal(posterScoreTone(null),'unrated');
  assert.equal(posterScoreTier(8.35),'unrated');
  assert.equal(posterScoreLabel(9.8),'挚爱');
});
