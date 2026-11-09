import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BLANK_CANVAS_VIEW,MIN_BLANK_CANVAS_WIDTH,MAX_BLANK_CANVAS_WIDTH,
  panBlankCanvas,zoomBlankCanvas,
} from './blankCanvasView.ts';

test('zoom keeps the actual pointed SVG location stationary and never edits model coordinates',()=>{
  const origin=DEFAULT_BLANK_CANVAS_VIEW;
  const pointer={x:108.25,y:41.75};
  const zoomed=zoomBlankCanvas(origin,pointer,0.7);
  assert.ok(zoomed.width<origin.width);
  assert.equal(zoomed.height/zoomed.width,origin.height/origin.width);
  for(const axis of ['x','y'] as const){
    const size=axis==='x'?'width':'height';
    assert.ok(Math.abs((pointer[axis]-zoomed[axis])/zoomed[size]-
      (pointer[axis]-origin[axis])/origin[size])<1e-12);
  }
  assert.deepEqual(origin,{x:-20,y:-20,width:240,height:160},
    'the default sketch viewport remains unchanged');
});

test('zoom bounds and nonfinite inputs fail closed without undefined viewBoxes',()=>{
  const origin=DEFAULT_BLANK_CANVAS_VIEW;
  const small=zoomBlankCanvas(origin,{x:0,y:0},1e-9);
  assert.equal(small.width,MIN_BLANK_CANVAS_WIDTH);
  const large=zoomBlankCanvas(origin,{x:0,y:0},1e9);
  assert.equal(large.width,MAX_BLANK_CANVAS_WIDTH);
  for(const factor of [0,-1,Infinity,NaN])
    assert.deepEqual(zoomBlankCanvas(origin,{x:0,y:0},factor),origin);
  assert.deepEqual(zoomBlankCanvas(origin,{x:NaN,y:0},2),origin);
  assert.equal(zoomBlankCanvas(small,{x:0,y:0},0.5).width,small.width);
});

test('middle pan only shifts the viewport in SVG units, not a draft point',()=>{
  const origin=DEFAULT_BLANK_CANVAS_VIEW;
  const delta={x:23.5,y:-15.25};
  const moved=panBlankCanvas(origin,delta);
  assert.equal(moved.x,origin.x-delta.x);
  assert.equal(moved.y,origin.y-delta.y);
  assert.equal(moved.width,origin.width);
  assert.equal(moved.height,origin.height);
  assert.deepEqual(panBlankCanvas(origin,{x:NaN,y:3}),origin);
});
