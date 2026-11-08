import test from 'node:test';
import assert from 'node:assert/strict';
import {frameCadCamera} from './cameraViews.ts';
const plate={minX:0,maxX:150,minY:0,maxY:80,thickness:12};
test('all four CAD camera presets preserve centre, fit all corners and set orthogonal axes',()=>{
  for(const preset of ['top','front','right','isometric'] as const){
    const f=frameCadCamera(plate,16/9,preset);
    assert.deepEqual(f.center,{x:75,y:40,z:6});
    const r=Math.hypot(150,80,12)/2,phi=20*Math.PI/180;
    assert.ok(r/f.distance<Math.sin(phi));
    assert.ok(Math.abs(Math.hypot(f.offset.x,f.offset.y,f.offset.z)-1)<1e-12);
  }
  assert.deepEqual(frameCadCamera(plate,1,'top').offset,{x:0,y:0,z:1});
  assert.deepEqual(frameCadCamera(plate,1,'front').up,{x:0,y:0,z:1});
  assert.deepEqual(frameCadCamera(plate,1,'right').offset,{x:1,y:0,z:0});
});
test('narrow panels demand a greater fit distance; edited geometry refits',()=>{
  assert.ok(frameCadCamera(plate,.5,'top').distance>frameCadCamera(plate,2,'top').distance);
  assert.deepEqual(frameCadCamera({...plate,maxX:180,thickness:30},2,'top').center,{x:90,y:40,z:15});
});
test('invalid geometry is refused without contaminating model authority',()=>{
  for(const box of [{...plate,maxX:0},{...plate,thickness:0},{...plate,minY:Infinity}])
    assert.throws(()=>frameCadCamera(box,1,'top'),/Cannot frame/);
  assert.throws(()=>frameCadCamera(plate,0,'top'),/Cannot frame/);
  assert.throws(()=>frameCadCamera(plate,1,'bad' as never),/Cannot frame/);
});
