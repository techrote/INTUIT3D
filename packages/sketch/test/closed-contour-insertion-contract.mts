import {createSketch,serializeSketch} from '@intuit3d/sketch';
import {createClosedContour} from '@intuit3d/sketch/closed-contour-authoring/v1';
import {insertClosedContourTab,inspectTabbedClosedContour,
  editTabbedContourVertex,CLOSED_CONTOUR_INSERTION_VERSION,
  type InsertContourTabCommand,type EditTabbedContourCommand,
  type TabbedContourHandle} from '@intuit3d/sketch/closed-contour-insertion/v1';

const source=createSketch({version:1,units:'mm',points:[],lines:[],
  circles:[],constraints:[]});
const created=createClosedContour(source,{
  kind:'create-closed-contour',version:1,
  sourceSignature:serializeSketch(source),contourId:'plate',
  vertices:[{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}]
});
if(created.kind!=='accepted')throw Error(created.reason);
const command:InsertContourTabCommand={
  kind:'insert-closed-contour-tab',version:CLOSED_CONTOUR_INSERTION_VERSION,
  sourceSignature:created.nextSourceSignature,contourId:'plate',
  edgeId:'plate:edge:1',tabId:'tab',
  vertices:[{x:140,y:20},{x:140,y:60}]
};
const inserted=insertClosedContourTab(created.sketch,created.selection,command);
if(inserted.kind==='accepted'){
  const inspection=inspectTabbedClosedContour(inserted.sketch,
    inserted.selection,'plate','tab');
  if(inspection.kind==='tabbed_closed_contour'){
    const handle:TabbedContourHandle=inspection.handles[2];
    const edit:EditTabbedContourCommand={
      kind:'edit-tabbed-contour-vertex',version:1,
      sourceSignature:inspection.sourceSignature,contourId:'plate',
      tabId:'tab',handleId:handle.handleId,target:{x:145,y:20}
    };
    const result=editTabbedContourVertex(inserted.sketch,inserted.selection,edit);
    if(result.kind==='accepted'){
      const label:string=result.handles[2].handleId;
      const nextSignature:string=result.nextSourceSignature;
      void [label,nextSignature];
    }
  }
}
