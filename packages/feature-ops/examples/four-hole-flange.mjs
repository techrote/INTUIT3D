/** Real accepted INTENT/SKETCH/RUNTIME consumer (requires INTUIT3D monorepo). */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {authorMountingFlange,editExtrudeThickness,FEATURE_OPS_FORMAT,FEATURE_OPS_VERSION} from '../src/index.mjs';
const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const services={model,runtime,sketch,discovery};
const empty=transactions.startUndoHistory(model.newProject('flange.mount.four.bolt'));
const built=authorMountingFlange(empty,{
  format:FEATURE_OPS_FORMAT,version:FEATURE_OPS_VERSION,
  eventId:'author.flange',expectedRevision:empty.document.revision,
  sketchFeatureId:'sketch.flange',extrudeFeatureId:'extrude.flange',
  cutFeatureId:'cut.flange',targetBodyId:'body.flange',thicknessMm:10,
  spec:{widthMm:180,depthMm:100,units:'mm',frame:'local_centered_xy',holes:[
    {id:'nw',xMm:-70,yMm:30,radiusMm:5},{id:'ne',xMm:70,yMm:30,radiusMm:5},
    {id:'sw',xMm:-70,yMm:-30,radiusMm:5},{id:'se',xMm:70,yMm:-30,radiusMm:5},
  ]}},services);
const edited=editExtrudeThickness(built.history,{eventId:'edit.thickness',featureId:'extrude.flange',
  expectedRevision:built.history.document.revision,thicknessMm:16},services);
const reopened=runtime.reopen(runtime.save(edited.history));
if (runtime.inspect(reopened).features.find(f=>f.featureId==='cut.flange')?.status !== 'pending_exact_provider')
  throw Error('CUT must remain explicitly pending exact geometry');
console.log(JSON.stringify({projectId:reopened.document.projectId,revision:reopened.document.revision,
  initialStatus:built.report.features.map(f=>[f.featureId,f.status]),
  editedStatus:runtime.inspect(reopened).features.map(f=>[f.featureId,f.status]),
  invalidated:edited.invalidation.invalidatedFeatureIds,
  nativeHandoff:built.nativeHandoff,
  provenance:'actual_INTENT_SKETCH_RUNTIME_no_native_invoked',exactAuthority:false,
  independentInteroperability:false},null,2));
