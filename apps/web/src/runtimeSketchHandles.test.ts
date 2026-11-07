import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDimensionAtPoint,nudgeSketchHandle,snapHandleMillimetres} from './runtimeSketchHandles.ts';

const bounds={minX:0,minY:0,maxX:120,maxY:80};
const centers={holeA:{x:35,y:40},holeB:{x:85,y:40}};

test('datum-relative outer edge handles and independent hole rim dimensions',()=>{
  assert.equal(handleDimensionAtPoint('width',{x:132,y:40},bounds,centers),132);
  assert.equal(handleDimensionAtPoint('depth',{x:60,y:94},bounds,centers),94);
  assert.equal(handleDimensionAtPoint('holeA.diameter',{x:43,y:40},bounds,centers),16);
  assert.equal(handleDimensionAtPoint('holeB.diameter',{x:91,y:40},bounds,centers),12);
  assert.equal(handleDimensionAtPoint('holeA.diameter',{x:43.26,y:41},bounds,centers),16.5);
  assert.equal(handleDimensionAtPoint('holeA.diameter',{x:43.26,y:41},bounds,centers,true),16.5);
});
test('invalid drag proposals fail closed; fine drag and arrow directions stay deterministic',()=>{
  assert.equal(handleDimensionAtPoint('holeB.diameter',{x:83,y:40},bounds,centers),null);
  assert.equal(handleDimensionAtPoint('width',{x:Infinity,y:1},bounds,centers),null);
  assert.equal(handleDimensionAtPoint('depth',{x:1,y:10001},bounds,centers),null);
  assert.equal(snapHandleMillimetres(134.14,true),134.1);
  assert.equal(nudgeSketchHandle('width',120,'ArrowRight'),121);
  assert.equal(nudgeSketchHandle('depth',80,'ArrowUp',true),80.1);
  assert.equal(nudgeSketchHandle('holeB.diameter',12,'ArrowLeft'),11);
  assert.equal(nudgeSketchHandle('depth',80,'ArrowRight'),null);
  assert.equal(nudgeSketchHandle('width',0.5,'ArrowLeft'),null);
});
