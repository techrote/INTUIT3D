import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from './index.mjs';

export declare const PERSISTENT_HISTORY_FORMAT:'intuit3d.workflow-persistent-history';
export declare const PERSISTENT_HISTORY_VERSION:1;

/**
 * Synchronous single-key failure-atomic storage. Browser localStorage
 * satisfies this; getItem/setItem do NOT implement cross-tab compare-and-swap.
 * The host must arrange a single writer for the project key.
 */
export interface AtomicArchiveStorage {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
}
export interface PersistentHistorySource {
  readonly format:typeof PERSISTENT_HISTORY_FORMAT;
  readonly version:typeof PERSISTENT_HISTORY_VERSION;
  readonly key:string;
  /** Fresh authoritative archive decode; never a mutable shadow document. */
  readCurrentHistory():UndoHistory;
  /** Synchronous, fail-closed archive publish for LivePlateSession. */
  publishHistory(history:UndoHistory):void;
  /** Canonical persisted archive; never a STEP/B-rep receipt. */
  save():string;
}
export declare function createPersistentHistorySource(options:Readonly<{
  runtime:Pick<WorkflowRuntime,'save'|'reopen'|'inspect'>;
  storage:AtomicArchiveStorage;
  key?:string;
  initialHistory?:UndoHistory;
}>):PersistentHistorySource;
