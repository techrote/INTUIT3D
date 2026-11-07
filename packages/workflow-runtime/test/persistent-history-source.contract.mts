import type {UndoHistory} from '@intuit3d/model/transactions';
import type {AtomicArchiveStorage,PersistentHistorySource} from '../persistent-history-source.mjs';
import {createPersistentHistorySource,PERSISTENT_HISTORY_FORMAT} from '../persistent-history-source.mjs';
import type {WorkflowRuntime} from '../index.mjs';
import type {LivePlateSession,LiveCadCommand} from '../live-plate-session.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';

declare const runtime:WorkflowRuntime;
declare const storage:AtomicArchiveStorage;
declare const initialHistory:UndoHistory;
const source:PersistentHistorySource=createPersistentHistorySource({
  runtime,storage,initialHistory,key:'intuit3d.demo.v1',
});
const format:'intuit3d.workflow-persistent-history'=PERSISTENT_HISTORY_FORMAT;
const session:LivePlateSession=createLivePlateSession({runtime,...source});
const history:UndoHistory=source.readCurrentHistory();
source.publishHistory(history);
const serialized:string=source.save();
const command:LiveCadCommand={
  kind:'sketch.holes',
  projectId:'typed.contract.project',
  expectedRevision:0,
  request:{sketchFeatureId:'sketch.plate',eventId:'contract.add',
    operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}]},
};
const applied=session.applyCommand(command);
const evaluated=session.applyCommandAndEvaluate(command,{requiredBackend:'OCCT-cxx-8.0.1'});
const undo:LiveCadCommand={kind:'model.undo',projectId:'typed.contract.project',
  expectedRevision:1,eventIds:['typed.undo']};
const modelEvent:LiveCadCommand={kind:'model.events',projectId:'typed.contract.project',
  expectedRevision:0,events:[]};
// @ts-expect-error consumer must include a source revision fence
const missingFence:LiveCadCommand={kind:'model.undo',projectId:'typed.contract.project',eventIds:[]};
const forgedFence:LiveCadCommand={kind:'sketch.holes',projectId:'typed.contract.project',
  expectedRevision:0,
  // @ts-expect-error the runtime alone injects the authoritative command revision
  request:{expectedRevision:0,sketchFeatureId:'sketch.plate',
    eventId:'forged',operations:[]}};
void [format,session,serialized,applied,evaluated,undo,modelEvent,missingFence,forgedFence];
