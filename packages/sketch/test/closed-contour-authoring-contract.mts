import type {SketchDocument} from '@intuit3d/sketch';
import {createClosedContour,inspectClosedContour,editClosedContourVertices,
  dragClosedContourVertex,CLOSED_CONTOUR_AUTHORING_VERSION,
  MAX_CLOSED_CONTOUR_VERTICES,
  type ClosedContourAccepted,type ClosedContourRefusal,
  type ClosedContourInspection,type ClosedContourDragged}
  from '@intuit3d/sketch/closed-contour-authoring/v1';
declare const doc:SketchDocument;
declare const signature:string;
const created=createClosedContour(doc,{
  kind:'create-closed-contour',version:1,sourceSignature:signature,
  contourId:'profileA',vertices:[
    {x:0,y:0},{x:80,y:0},{x:80,y:40},{x:0,y:40}
  ]});
if(created.kind==='accepted'){
  const inspection=inspectClosedContour(created.sketch,created.selection,'profileA');
  const edited=editClosedContourVertices(created.sketch,created.selection,{
    kind:'edit-closed-contour-vertices',version:1,
    sourceSignature:created.nextSourceSignature,contourId:'profileA',
    changes:[{index:2,xMm:90,yMm:45}]});
  const moved=dragClosedContourVertex(created.sketch,created.selection,{
    version:1,sourceSignature:created.nextSourceSignature,
    contourId:'profileA',handleId:'profileA:handle:2',
    target:{x:90,y:45}});
  const typed:ClosedContourAccepted=created;
  const maybe:ClosedContourInspection|ClosedContourRefusal=inspection;
  const drag:ClosedContourDragged|ClosedContourAccepted|ClosedContourRefusal=moved;
  void [typed,maybe,drag,edited];
}else{
  const refused:ClosedContourRefusal=created;
  void refused;
}
void [CLOSED_CONTOUR_AUTHORING_VERSION,MAX_CLOSED_CONTOUR_VERTICES];
