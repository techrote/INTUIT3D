import test from 'node:test';
import assert from 'node:assert/strict';
import { circleDrawingPreview, nextCircleDrawing } from './circleDrawing.ts';

test('two pointer clicks form one dimensioned circle; first click is not a document mutation',()=>{
  const initial={phase:'centre'} as const;
  const armed=nextCircleDrawing(initial,{x:60.2,y:65.13});
  assert.deepEqual(armed,{phase:'radius',center:{x:60,y:65}});
  assert.deepEqual(circleDrawingPreview(armed as {phase:'radius';center:{x:number;y:number}}, {x:65,y:65}),
    {x:60,y:65,radius:5});
  assert.deepEqual(nextCircleDrawing(armed as {phase:'radius';center:{x:number;y:number}},{x:65,y:65}),
    {phase:'complete',circle:{x:60,y:65,diameter:10}});
});

test('zero radius, nonfinite projection and oversized drawing are refused without changing draft',()=>{
  const armed={phase:'radius',center:{x:20,y:30}} as const;
  assert.equal(nextCircleDrawing(armed,{x:20.2,y:30.1}).phase,'refused');
  assert.equal(nextCircleDrawing(armed,{x:NaN,y:30}).phase,'refused');
  assert.equal(nextCircleDrawing(armed,{x:9000,y:9000}).phase,'refused');
  assert.deepEqual(armed,{phase:'radius',center:{x:20,y:30}});
  assert.equal(nextCircleDrawing({phase:'idle'},{x:20,y:30}).phase,'refused');
  assert.equal(circleDrawingPreview({phase:'idle'},{x:20,y:30}),null);
});
