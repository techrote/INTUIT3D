/**
 * Browser-local crash-recovery copies of authoritative serialized RUNTIME archives.
 * IndexedDB is storage, never a second source of model, geometry or STEP truth.
 * No network, no unsandboxed filesystem access, and no implicit project reopen.
 */
import type { ModelSession } from './runtimeSession';
import { modelArchiveSummary, checkedModelArchiveSize } from './modelFileLifecycle.ts';

export const LOCAL_RECOVERY_DB = 'intuit3d-local-recovery-v1';
const STORE = 'snapshots';
const VERSION = 1;
const MAX_SNAPSHOTS = 6;

export interface LocalRecoverySummary {
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  readonly undoFrames: number;
  readonly redoFrames: number;
  readonly updatedAt: number;
  readonly bytes: number;
  readonly exportRequested: boolean;
}
interface LocalRecoveryRecord extends LocalRecoverySummary {
  readonly format: 'intuit3d.local-recovery';
  readonly version: 1;
  readonly archive: string;
}

/** A fixed-size, immutable projection of an actual RUNTIME archive and journal. */
export function makeLocalRecoveryRecord(history: ModelSession, id: string,
  archive: string, exportRequested: boolean, updatedAt = Date.now()
): LocalRecoveryRecord {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id))
    throw Error('Local recovery requires a valid session key.');
  if (typeof archive !== 'string')
    throw TypeError('Local recovery requires an authoritative archive string.');
  const bytes = checkedModelArchiveSize(archive);
  const {projectId,revision,undoFrames,redoFrames} = modelArchiveSummary(history);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0)
    throw Error('Invalid local recovery timestamp.');
  return {
    format:'intuit3d.local-recovery', version:1, id, archive,
    projectId,revision,undoFrames,redoFrames,updatedAt,bytes,exportRequested
  };
}

function validRecord(raw: unknown): raw is LocalRecoveryRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v=raw as Partial<LocalRecoveryRecord>;
  return v.format==='intuit3d.local-recovery' && v.version===1 &&
    typeof v.id==='string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v.id) &&
    typeof v.projectId==='string' && v.projectId.length<=256 &&
    [v.revision,v.undoFrames,v.redoFrames,v.updatedAt,v.bytes].every(
      x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0
    ) && typeof v.exportRequested==='boolean' &&
    typeof v.archive==='string' && v.archive.length<=4*1024*1024 &&
    new Blob([v.archive]).size===v.bytes;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB==='undefined')
    return Promise.reject(Error('Browser local recovery is unavailable (IndexedDB disabled).'));
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(LOCAL_RECOVERY_DB,VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||Error('Cannot open browser recovery storage.'));
    req.onblocked=()=>reject(Error('Browser recovery storage is locked by another tab.'));
  });
}

async function withDb<T>(op:(db:IDBDatabase)=>Promise<T>):Promise<T> {
  const db=await openDb();
  try{return await op(db);}finally{db.close();}
}

export async function listLocalRecoveries():Promise<LocalRecoverySummary[]> {
  return withDb(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).getAll();
    req.onerror=()=>reject(req.error||Error('Cannot read recovery snapshots.'));
    req.onsuccess=()=>resolve((req.result as unknown[]).filter(validRecord)
      .map(({id,projectId,revision,undoFrames,redoFrames,updatedAt,bytes,exportRequested})=>
        ({id,projectId,revision,undoFrames,redoFrames,updatedAt,bytes,exportRequested}))
      .sort((a,b)=>b.updatedAt-a.updatedAt));
  }));
}

export async function storeLocalRecovery(history:ModelSession, id:string,
  archive:string, exportRequested:boolean):Promise<void> {
  const record=makeLocalRecoveryRecord(history,id,archive,exportRequested);
  await withDb(db=>new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    const store=tx.objectStore(STORE);
    store.put(record);
    // Bound accumulated storage: keep the most recent sessions, and never
    // prune a newly written session based on an older timestamp.
    const all=store.getAll();
    all.onsuccess=()=>{
      const sorted=(all.result as unknown[]).filter(validRecord)
        .sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
      const keep=new Set(sorted.slice(0,MAX_SNAPSHOTS).map(v=>v.id));
      keep.add(id);
      for(const v of sorted)if(!keep.has(v.id))store.delete(v.id);
    };
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||Error('Local recovery write failed.'));
    tx.onabort=()=>reject(tx.error||Error('Local recovery write aborted.'));
  }));
}

export async function readLocalRecovery(id:string):Promise<string> {
  return withDb(db=>new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readonly').objectStore(STORE).get(id);
    req.onerror=()=>reject(req.error||Error('Cannot read local recovery.'));
    req.onsuccess=()=>{
      if(!validRecord(req.result)){reject(Error('Local recovery is missing, corrupt or unsupported.'));return;}
      resolve(req.result.archive);
    };
  }));
}

export async function deleteLocalRecovery(id:string):Promise<void> {
  await withDb(db=>new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||Error('Cannot remove local recovery.'));
    tx.onabort=()=>reject(tx.error||Error('Local recovery deletion aborted.'));
  }));
}
