import {createSketch} from '../index.mjs';
import {suggestSketchSnaps} from '../snap.mjs';
import {proposeSnapConstraint,commitSnapConstraint,SNAP_ADMISSION_VERSION,
  type SnapAdmissionProposal,type SnapAdmissionCommand,type SnapAdmissionStatus} from '../snap-admission.mjs';
const doc=createSketch({version:1,units:'mm',points:[{id:'p',x:0,y:0}],lines:[],circles:[],constraints:[]});
const cmd:SnapAdmissionCommand={pointId:'p',constraintId:'newFix',snap:suggestSketchSnaps(doc,{x:0,y:0},{gridMm:1,excludeIds:['p']}),
  options:{gridMm:1,excludeIds:['p']}};
const result:SnapAdmissionProposal=proposeSnapConstraint(doc,cmd);
const status:SnapAdmissionStatus=result.status;
if(status==='admissible') {
  const changed=commitSnapConstraint(doc,result);
  void changed;
}
const version:1=SNAP_ADMISSION_VERSION;
// @ts-expect-error a preview-only proposal cannot be exact geometry
const authoritative:false=result.previewOnly;
// @ts-expect-error unsolved geometry cannot be assumed present
const geometry=result.previewGeometry.points;
void geometry;void authoritative;void version;
