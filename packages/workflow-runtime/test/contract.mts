import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime, type RuntimeReport, type RuntimeFeature} from '../index.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const session=transactions.startUndoHistory(model.newProject('runtime.contract'));
const report:RuntimeReport=runtime.inspect(session);
const result:RuntimeFeature | undefined=report.features[0];
if(result?.status==='preview_only') {
  const body:string|undefined=result.bodyId;
  void body;
}
