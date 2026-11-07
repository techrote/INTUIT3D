import test from 'node:test';
import assert from 'node:assert/strict';
import {radialHoleDiameter,nudgeHoleDiameter} from './holeDiameterDrag.ts';

test('radial diameter works in every quadrant with stable snapping',()=>{
  const c={x:60,y:65};
  assert.equal(radialHoleDiameter(c,{x:60,y:58}),14);
  assert.equal(radialHoleDiameter(c,{x:53,y:65}),14);
  assert.equal(radialHoleDiameter(c,{x:60,y:72}),14);
  assert.equal(radialHoleDiameter(c,{x:67,y:65}),14);
  assert.equal(radialHoleDiameter(c,{x:63.26,y:65}),6.5);
  assert.equal(radialHoleDiameter(c,{x:63.26,y:65},true),6.5);
});
test('refuse non-finite, zero and excessive diameter without inventing a constraint',()=>{
  const c={x:60,y:65};
  assert.equal(radialHoleDiameter(c,c),null);
  assert.equal(radialHoleDiameter(c,{x:NaN,y:65}),null);
  assert.equal(radialHoleDiameter(c,{x:6000,y:65}),null);
  assert.equal(radialHoleDiameter(c,{x:60.3,y:65}),0.5);
});
test('accessible diameter arrows preserve limits and fine precision',()=>{
  assert.equal(nudgeHoleDiameter(14,'ArrowRight'),15);
  assert.equal(nudgeHoleDiameter(14,'ArrowDown'),13);
  assert.equal(nudgeHoleDiameter(14,'ArrowUp',true),14.1);
  assert.equal(nudgeHoleDiameter(0.5,'ArrowLeft'),null);
  assert.equal(nudgeHoleDiameter(10000,'ArrowUp'),null);
  assert.equal(nudgeHoleDiameter(14,'Enter'),null);
});
