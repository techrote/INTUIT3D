import {createCenteredHolePlate,inspectCenteredHolePlate,
  editCenteredHolePlateDimension,dragCenteredHolePlateHandle,
  type CenteredHolePlateRequest,type CenteredHolePlateStatus} from '../centered-hole-plate.mjs';
const request:CenteredHolePlateRequest={
  id:'plate',widthMm:120,heightMm:80,leftInsetMm:35,rightInsetMm:35,
  holeARadiusMm:6,holeBRadiusMm:6
};
const doc=createCenteredHolePlate(request);
const view=inspectCenteredHolePlate(doc,'plate');
const status:CenteredHolePlateStatus=view.status;
const edit=editCenteredHolePlateDimension(doc,'plate',{
  version:1,expectedSignature:view.sourceSignature,dimension:'widthMm',valueMm:150
});
const drag=dragCenteredHolePlateHandle(doc,'plate',{
  version:1,expectedSignature:view.sourceSignature,
  handleId:'plate:handle:rightInsetMm',target:{x:100,y:40}
});
if(edit.kind==='accepted')console.log(edit.profile?.areaMm2,status);
if(drag.kind==='accepted')console.log(drag.solution.status);
