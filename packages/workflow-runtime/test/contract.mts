import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime, diffWorkflowPlans, type WorkflowInvalidation, type RuntimeReport, type RuntimeFeature} from '../index.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const session=transactions.startUndoHistory(model.newProject('runtime.contract'));
const report:RuntimeReport=runtime.inspect(session);
const result:RuntimeFeature | undefined=report.features[0];
if(result?.status==='preview_only') {
  const body:string|undefined=result.bodyId;
  void body;
}

const atomicSketchEdit=runtime.editSketchConstraints(session,{
  sketchFeatureId:'sketch.plate',eventId:'edit.contract.sketch',
  expectedRevision:session.document.revision,
  edits:[{constraintId:'width',patch:{value:140}}],
  admission:'require_admissible',
});
if(atomicSketchEdit.kind==='committed') {
  const documentRevision:number=atomicSketchEdit.history.document.revision;
  const invalidated:readonly string[]=atomicSketchEdit.invalidation.invalidatedFeatureIds;
  const status:string=atomicSketchEdit.sketchStatus;
  void [documentRevision,invalidated,status];
} else {
  const candidateOnly:true=atomicSketchEdit.notCommitted;
  const candidateStatus:string=atomicSketchEdit.candidateFeature.status;
  void [candidateOnly,candidateStatus];
}

const thirdHole=runtime.editPlateHoles(session,{
  sketchFeatureId:'sketch.plate',eventId:'author.contract.hole',
  expectedRevision:session.document.revision,admission:'require_admissible',
  operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}],
});
if(thirdHole.kind==='committed'){
  const sourceRevision:number=thirdHole.invalidation.previousRevision;
  const createdRevision:number=thirdHole.history.document.revision;
  void [sourceRevision,createdRevision];
} else {
  const notCommitted:true=thirdHole.notCommitted;
  void notCommitted;
}

const arrayHoles=runtime.patternPlateHoles(session,{
  sketchFeatureId:'sketch.plate',eventId:'author.contract.array',
  expectedRevision:session.document.revision,sourceHoleId:'holeA',
  idPrefix:'array',columns:2,rows:2,pitchXmm:16,pitchYmm:-18,
});
if(arrayHoles.kind==='committed') {
  const invalidated:readonly string[]=arrayHoles.invalidation.invalidatedFeatureIds;
  void invalidated;
}

const polarHoles=runtime.patternCircularHoles(session,{
  sketchFeatureId:'sketch.plate',eventId:'author.contract.polar',
  expectedRevision:session.document.revision,sourceHoleId:'holeA',
  idPrefix:'polar',instances:4,pivotXmm:45,pivotYmm:40,sweepDegrees:360,
});
if(polarHoles.kind==='committed') {
  const invalidated:readonly string[]=polarHoles.invalidation.invalidatedFeatureIds;
  void invalidated;
}

const resizedLayout=runtime.resizePlateHoleLayout(session,{
  sketchFeatureId:'sketch.plate',eventId:'layout.contract.resize',
  expectedRevision:session.document.revision,admission:'require_admissible',
  holeIds:['holeA','holeB'],pivotXmm:60,pivotYmm:40,
  scaleX:0.8,scaleY:1,radiusScale:0.75,
});
if(resizedLayout.kind==='committed'){
  const stableIds:readonly string[]=resizedLayout.invalidation.invalidatedFeatureIds;
  void stableIds;
}
const edgeResult=runtime.editSelectedEdgeHoles(session,{
  sketchFeatureId:'sketch.plate',eventId:'type.selected.edge',
  expectedRevision:session.document.revision,
  selection:{candidateId:'contour',sourceSignature:'sketch-signature'},
  command:{kind:'set-edge-holes',sourceSignature:'sketch-signature',
    edits:[{holeId:'holeC',edgeId:'edge0',alongMm:10,insetMm:5,radiusMm:2}]},
});
if(edgeResult.kind==='committed'){
  const stableProfile:string=edgeResult.semanticProfileId;
  const analyticalOnly:false=edgeResult.exactAuthority;
  void [stableProfile,analyticalOnly];
}else{
  const refused:true=edgeResult.notCommitted;
  void refused;
}
const profileHoleResult=runtime.editSelectedProfileHole(session,{
  sketchFeatureId:'sketch.plate',eventId:'type.selected.profile.hole',
  expectedRevision:session.document.revision,
  selection:{candidateId:'contour',sourceSignature:'sketch-signature'},
  command:{kind:'add-hole',sourceSignature:'sketch-signature',
    holeId:'mount:profile',anchorPointId:'corner-a',xMm:60,yMm:20,radiusMm:3},
});
if(profileHoleResult.kind==='committed'){
  const selected:string=profileHoleResult.semanticProfileId;
  const noNative:false=profileHoleResult.exactAuthority;
  void [selected,noNative];
}
const layout=runtime.editSelectedProfileHoleLayout(session,{
  sketchFeatureId:'sketch.plate',eventId:'type.atomic.profile.layout',
  expectedRevision:session.document.revision,
  selection:{candidateId:'cycle:example',sourceSignature:'snapshot'},
  command:{kind:'set-hole-layout',sourceSignature:'snapshot',
    edits:[{holeId:'holeA',xMm:15,yMm:20,radiusMm:3}]},
});
if(layout.kind==='committed') {
  const ids:readonly string[]=layout.affectedHoleIds;
  const noExact:false=layout.exactAuthority;
  void [ids,noExact];
}
const layoutView=runtime.inspectSelectedProfileHoleLayout(session,{
  projectId:session.document.projectId,expectedRevision:session.document.revision,
  sketchFeatureId:'sketch.plate',
});
if(layoutView.kind==='ready') {
  const ids:string[]=layoutView.inspection.holes.map(h=>h.holeId);
  void ids;
}
const delta:WorkflowInvalidation=runtime.diff(session,session);
const direct:WorkflowInvalidation=diffWorkflowPlans(model.planProject(session.document),model.planProject(session.document));
const exact:false=delta.exactReuseAllowed;
const affected:readonly string[]=direct.invalidatedFeatureIds;
void exact;void affected;

import * as kernelPlate from '@intuit3d/kernel-contract/plate-v1';
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';
import {createExperimentalPlateWorkflow, rectanglePlateFromProfile,
  type ExperimentalPlateWorkflowResult} from '../experimental-plate.mjs';
const experimental=createExperimentalPlateWorkflow({runtime,model,
  plateContract:kernelPlate,runExperimentalPlate});
const experimentalResult:Promise<ExperimentalPlateWorkflowResult>=experimental.evaluate(session,{
  requestId:'runtime.typed.plate',cutFeatureId:'cut',readCurrentHistory:()=>session});
void experimentalResult;
const rectangle=rectanglePlateFromProfile({status:'analytic_profile_only',units:'mm',
  outer:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],holes:[{x:0.5,y:0.5,radius:0.1}]},1);
const width:number=rectangle.width;
void width;

const rigidGroup=runtime.transformPlateHoles(session,{
  sketchFeatureId:'sketch.plate',eventId:'author.contract.rigid-group',
  expectedRevision:session.document.revision,
  holeIds:['holeA','holeB'],rotateDegrees:90,pivotXmm:60,pivotYmm:40,
  translateXmm:5,translateYmm:0,
});
if(rigidGroup.kind==='committed') {
  const invalidated:readonly string[]=rigidGroup.invalidation.invalidatedFeatureIds;
  void invalidated;
} else {
  const notCommitted:true=rigidGroup.notCommitted;
  void notCommitted;
}
