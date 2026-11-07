import type {UndoHistory} from '@intuit3d/model/transactions';
import type {AtomicArchiveStorage,PersistentHistorySource} from '../persistent-history-source.mjs';
import {createPersistentHistorySource,PERSISTENT_HISTORY_FORMAT} from '../persistent-history-source.mjs';
import type {WorkflowRuntime} from '../index.mjs';
import type {LivePlateSession} from '../live-plate-session.mjs';
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
void [format,session,serialized];
