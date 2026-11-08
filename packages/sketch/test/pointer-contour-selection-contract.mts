import type {
  PointerContourInventory,PointerProfileRefusal,PointerContourSelected,
  PointerContourEdgeSelected,PointerProfileMiss,SelectContourPointerCommand,
  PickContourEdgePointerCommand
} from '@intuit3d/sketch/pointer-contour-selection/v1';
import {inspectPointerSelectableContours,selectContourAtPointer,
  pickContourEdgeAtPointer,POINTER_CONTOUR_SELECTION_VERSION}
  from '@intuit3d/sketch/pointer-contour-selection/v1';
import {createDimensionedLPlateSketch}
  from '@intuit3d/sketch/selected-profile/v1';
import {serializeSketch} from '@intuit3d/sketch';

const source=createDimensionedLPlateSketch();
const signature=serializeSketch(source);
const inventory:PointerContourInventory|PointerProfileRefusal=
  inspectPointerSelectableContours(source);
const click:SelectContourPointerCommand={
  kind:'select-contour-at-pointer',version:POINTER_CONTOUR_SELECTION_VERSION,
  sourceSignature:signature,point:{x:10,y:40},boundaryClearanceMm:0.1
};
const selected:PointerContourSelected|PointerProfileMiss|PointerProfileRefusal=
  selectContourAtPointer(source,click);
const edgeClick:PickContourEdgePointerCommand={
  kind:'pick-contour-edge-at-pointer',version:1,
  sourceSignature:signature,point:{x:65,y:0.5},maxDistanceMm:1
};
const edge:PointerContourEdgeSelected|PointerProfileMiss|PointerProfileRefusal=
  pickContourEdgeAtPointer(source,edgeClick);
if(inventory.kind==='pointer_selectable_contours'){
  const ids:string[]=inventory.candidates.map(c=>c.semanticProfileId);
  void ids;
}
if(selected.kind==='selected'){
  const selectionId:string=selected.selection.candidateId;
  void selectionId;
}
if(edge.kind==='selected_edge'){
  const along:number=edge.hit.alongMm;
  const semanticEdgeId:string=edge.edgeId;
  void along;void semanticEdgeId;
}
