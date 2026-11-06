import type {DragProjection, DragProjectionStatus} from '../drag-projection.mjs';
import {suggestProjectedDrag,DRAG_PROJECTION_VERSION} from '../drag-projection.mjs';
import {plateSketchFixture} from '../index.mjs';
const result:DragProjection=suggestProjectedDrag(plateSketchFixture(),'p1',{x:120,y:0});
const status:DragProjectionStatus=result.status;
const api:1=DRAG_PROJECTION_VERSION;
void status;void api;
if(result.geometry&&result.resolvedTarget){
  const value:number=result.resolvedTarget.x;
  void value;
}
