import {
  createOffsetHolePlate,inspectOffsetHolePlate,
  editOffsetHolePlateDimensions,dragOffsetHolePlateHandle
} from '../centered-hole-plate-v2.mjs';
import type {
  OffsetHoleDimension,OffsetHolePlateInspection,OffsetHoleHandle,
  OffsetHoleEdit,OffsetHolePlateStatus
} from '../centered-hole-plate-v2.mjs';

const source=createOffsetHolePlate({
  id:'mount',widthMm:120,heightMm:80,leftInsetMm:35,rightInsetMm:35,
  holeARadiusMm:6,holeBRadiusMm:6,holeAYOffsetMm:5,holeBYOffsetMm:-5
});
const inspection:OffsetHolePlateInspection=inspectOffsetHolePlate(source,'mount');
const name:OffsetHoleDimension='holeBYOffsetMm';
const status:OffsetHolePlateStatus=inspection.status;
const handle:OffsetHoleHandle|undefined=inspection.handles.find(h=>h.kind==='hole_center');
const edit:OffsetHoleEdit=editOffsetHolePlateDimensions(source,'mount',{
  version:2,expectedSignature:inspection.sourceSignature,changes:{[name]:10}
});
const drag:OffsetHoleEdit=dragOffsetHolePlateHandle(source,'mount',{
  version:2,expectedSignature:inspection.sourceSignature,
  handleId:'mount:handle:B',target:{x:100,y:54}
});
if(handle?.kind==='hole_center'){
  const which:'A'|'B'=handle.hole;
  void which;
}
if(edit.kind==='accepted') {
  const mm:number=edit.dimensions.holeBYOffsetMm;
  const onlyPreview:true=edit.previewOnly;
  const noNative:false=edit.nativeExact;
  void [mm,onlyPreview,noNative];
}
if(drag.kind==='accepted'){
  const gesture=drag.gesture;
  void gesture?.appliedPoint;
}
void status;
