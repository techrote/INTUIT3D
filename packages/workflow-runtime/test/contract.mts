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
