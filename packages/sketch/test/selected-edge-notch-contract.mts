import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {serializeSketch} from '../index.mjs';
import {SELECTED_EDGE_NOTCH_VERSION,createSelectedEdgeNotch,
  inspectSelectedEdgeNotch,editSelectedEdgeNotch,
  dragSelectedEdgeNotchHandle} from '../selected-edge-notch.mjs';
import type {CreateEdgeNotchCommand,EditEdgeNotchCommand,DragEdgeNotchGesture,
  EdgeNotchAccepted,EdgeNotchInspection} from '../selected-edge-notch.mjs';
const doc=createDimensionedLPlateSketch();
const stamp=serializeSketch(doc);
const select={candidateId:'sample',sourceSignature:stamp};
const create:CreateEdgeNotchCommand={kind:'create-edge-notch',version:1,
  sourceSignature:stamp,notchId:'cutout',edgeId:'L:edge0',
  fromMm:40,toMm:60,depthMm:8};
const edit:EditEdgeNotchCommand={kind:'edit-edge-notch',version:1,
  sourceSignature:stamp,notchId:'cutout',fromMm:40,toMm:60,depthMm:10};
const drag:DragEdgeNotchGesture={version:1,sourceSignature:stamp,
  notchId:'cutout',handleId:'cutout:handle:depth',target:{x:50,y:10}};
const c=createSelectedEdgeNotch(doc,select,create);
const e=editSelectedEdgeNotch(doc,select,edit);
const i=inspectSelectedEdgeNotch(doc,select,'cutout');
const g=dragSelectedEdgeNotchHandle(doc,select,drag);
if(c.kind==='accepted'){const ready:EdgeNotchAccepted=c;void ready.sketch;}
if(i.kind==='selected_edge_notch'){const ready:EdgeNotchInspection=i;
  void ready.originalLengthMm;}
void [SELECTED_EDGE_NOTCH_VERSION,e,g];
