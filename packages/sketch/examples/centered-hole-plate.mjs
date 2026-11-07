import assert from 'node:assert/strict';
import {serializeSketch,parseSketch} from '../index.mjs';
import {createCenteredHolePlate,inspectCenteredHolePlate,
  editCenteredHolePlateDimension,dragCenteredHolePlateHandle} from '../centered-hole-plate.mjs';
let doc=createCenteredHolePlate({id:'plate',widthMm:120,heightMm:80,
  leftInsetMm:35,rightInsetMm:35,holeARadiusMm:6,holeBRadiusMm:6});
function report(step){
  const view=inspectCenteredHolePlate(doc,'plate');
  const p=new Map(view.solution.geometry?.points.map(p=>[p.id,p])??[]);
  console.log(JSON.stringify({step,status:view.status,dimensions:view.dimensions,
    holeA:p.get('plate:holeA:center')??null,holeB:p.get('plate:holeB:center')??null,
    profileId:view.profileId,areaMm2:view.profile?.areaMm2??null,
    nativeExact:view.nativeExact}));
  return view;
}
report('initial');
for(const [step,dimension,valueMm] of [
  ['width','widthMm',150],['height','heightMm',100],['radius','holeARadiusMm',7]
]){
  const result=editCenteredHolePlateDimension(doc,'plate',{
    version:1,expectedSignature:serializeSketch(doc),dimension,valueMm
  });
  assert.equal(result.kind,'accepted',result.reason);
  assert.equal(result.status,'solved',result.reason);
  doc=result.sketch;report(step);
}
const archive=serializeSketch(doc);
const drag=dragCenteredHolePlateHandle(doc,'plate',{
  version:1,expectedSignature:archive,
  handleId:'plate:handle:rightInsetMm',target:{x:120,y:500}
});
assert.equal(drag.kind,'accepted',drag.reason);
doc=drag.sketch;report('drag');
doc=parseSketch(serializeSketch(doc));report('reopen');
doc=parseSketch(archive);report('undo');
