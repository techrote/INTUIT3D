import assert from 'node:assert/strict';
import {serializeSketch,parseSketch} from '../index.mjs';
import {rectanglePlateFromProfile} from '../../workflow-runtime/experimental-plate.mjs';
import {
  createOffsetHolePlate,inspectOffsetHolePlate,
  editOffsetHolePlateDimensions,dragOffsetHolePlateHandle
} from '../centered-hole-plate-v2.mjs';

const source=createOffsetHolePlate({
  id:'mount',widthMm:120,heightMm:80,leftInsetMm:35,rightInsetMm:35,
  holeARadiusMm:6,holeBRadiusMm:6,holeAYOffsetMm:5,holeBYOffsetMm:-5
});
const report=(step,doc)=>{
  const v=inspectOffsetHolePlate(doc,'mount');
  assert.equal(v.status,'solved');
  const plate=rectanglePlateFromProfile(v.profile,8);
  console.log(JSON.stringify({step,profileId:v.profileId,
    widthMm:plate.width,heightMm:plate.depth,holes:plate.holes,
    degreesOfFreedom:v.solution.degreesOfFreedom,
    previewOnly:v.previewOnly,nativeExact:v.nativeExact}));
};
report('initial',source);
const resized=editOffsetHolePlateDimensions(source,'mount',{
  version:2,expectedSignature:serializeSketch(source),
  changes:{widthMm:150,heightMm:100}
});
assert.equal(resized.kind,'accepted');
report('resize',resized.sketch);
const moved=dragOffsetHolePlateHandle(resized.sketch,'mount',{
  version:2,expectedSignature:serializeSketch(resized.sketch),
  handleId:'mount:handle:B',target:{x:102,y:58}
});
assert.equal(moved.kind,'accepted');
report('drag_right_hole',moved.sketch);
report('reopen',parseSketch(serializeSketch(moved.sketch)));
report('undo',parseSketch(serializeSketch(resized.sketch)));
