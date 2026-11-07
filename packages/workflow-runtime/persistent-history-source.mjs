/**
 * Browser-safe, single-writer durable source for the accepted INTENT archive.
 *
 * One storage value IS the authoritative undo journal; every read reopens the
 * original model archive. There is no mirrored model, preview document or
 * separate history log. A synchronous Storage.setItem provides failure-atomic
 * replacement of one key (as localStorage does). Cross-tab/multi-process writes
 * require an external exclusive-writer lease; getItem/setItem are not CAS.
 */
export const PERSISTENT_HISTORY_FORMAT='intuit3d.workflow-persistent-history';
export const PERSISTENT_HISTORY_VERSION=1;
const DEFAULT_KEY='intuit3d.cad-project.v1';
const MAX_ARCHIVE_BYTES=2*1024*1024;

export function createPersistentHistorySource({
  runtime,storage,key=DEFAULT_KEY,initialHistory,
}={}) {
  if(typeof runtime?.save!=='function'||
      typeof runtime?.reopen!=='function'||
      typeof runtime?.inspect!=='function'||
      typeof storage?.getItem!=='function'||
      typeof storage?.setItem!=='function'||
      typeof key!=='string'||!key.trim()||key.length>128)
    throw new TypeError('persistent history: runtime, synchronous storage and bounded key required');

  function admit(serialized) {
    if(typeof serialized!=='string'||!serialized||
        new TextEncoder().encode(serialized).byteLength>MAX_ARCHIVE_BYTES)
      throw new Error('persistent history: missing or oversized archive; original stored value retained');
    let history,report;
    try {
      history=runtime.reopen(serialized);
      if(runtime.save(history)!==serialized)
        throw new Error('noncanonical archive');
      report=runtime.inspect(history);
      if(report.projectId!==history.document.projectId||
          report.revision!==history.document.revision||
          !Number.isSafeInteger(report.revision)||report.revision<0)
        throw new Error('project/revision mismatch');
    } catch {
      throw new Error('persistent history: stored archive failed authoritative admission; no overwrite');
    }
    return history;
  }
  function readStored() {
    const raw=storage.getItem(key);
    if(raw!==null&&typeof raw!=='string')
      throw new TypeError('persistent history: getItem must synchronously return string or null');
    return raw;
  }
  let observed=readStored();
  if(observed===null) {
    if(initialHistory===undefined)
      throw new Error('persistent history: no saved project and no initial history');
    const first=runtime.save(initialHistory);
    admit(first);
    // A failed write never publishes an in-memory shadow project.
    const write=storage.setItem(key,first);
    if(write&&typeof write.then==='function')
      throw new TypeError('persistent history: asynchronous storage is unsupported');
    if(readStored()!==first)
      throw new Error('persistent history: initial archive write was not durable');
    observed=first;
  } else {
    // Corrupt archives are NOT replaced by a healthy supplied initial project.
    admit(observed);
  }
  function readArchive() {
    const raw=readStored();
    if(raw===null)
      throw new Error('persistent history: stored project disappeared; refusing silent replacement');
    admit(raw);
    observed=raw;
    return raw;
  }
  function readCurrentHistory() {
    // Reopen each time so UI/consumer mutations cannot bypass journal writes.
    return runtime.reopen(readArchive());
  }
  function publishHistory(next) {
    const candidate=runtime.save(next);
    admit(candidate);
    if(candidate===observed)
      throw new Error('persistent history: no-op journal publication refused');
    const current=readStored();
    if(current!==observed)
      throw new Error('persistent history: stored project changed since authoritative read');
    // The storage adapter MUST guarantee synchronous single-key failure-atomic
    // setItem. The browser's localStorage does; no cross-tab CAS is implied.
    const write=storage.setItem(key,candidate);
    if(write&&typeof write.then==='function')
      throw new TypeError('persistent history: asynchronous storage is unsupported');
    if(readStored()!==candidate)
      throw new Error('persistent history: archive write/readback mismatch');
    observed=candidate;
  }
  return Object.freeze({
    format:PERSISTENT_HISTORY_FORMAT,version:PERSISTENT_HISTORY_VERSION,key,
    readCurrentHistory,publishHistory,save:readArchive,
  });
}
