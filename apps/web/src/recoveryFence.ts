/**
 * Best-effort optimistic fencing for the two-slot PREVIEW recovery journal.
 * One tab may not silently overwrite a draft changed by another tab since
 * its last observed snapshot. This is not a transactional/atomic filesystem,
 * nor a cross-process lock or an authoritative CAD persistence contract.
 */
export interface RecoveryPairStorage {
  getItem(key: string): string | null;
}

export interface RecoverySlotKeys {
  readonly current: string;
  readonly previous: string;
}

export interface RecoverySnapshot {
  readonly current: string | null;
  readonly previous: string | null;
}

export class RecoveryWriteConflict extends Error {
  constructor() {
    super('Another workbench tab changed local recovery data; export this tab to preview JSON before closing.');
    this.name = 'RecoveryWriteConflict';
  }
}

/** Capture both slots verbatim: do not rely on a hash or a non-unique timestamp. */
export function captureRecoverySnapshot(storage: RecoveryPairStorage, keys: RecoverySlotKeys): RecoverySnapshot {
  if (keys.current === keys.previous) throw new Error('Recovery slot keys must be distinct');
  return { current: storage.getItem(keys.current), previous: storage.getItem(keys.previous) };
}

export function sameRecoverySnapshot(a: RecoverySnapshot, b: RecoverySnapshot): boolean {
  return a.current === b.current && a.previous === b.previous;
}

/**
 * Both slots are checked BEFORE the first mutation. A failed check leaves
 * storage untouched. The caller must retain the returned snapshot for the
 * next edit and never silently refresh it after a conflict.
 *
 * Browser localStorage offers no atomic compare-and-swap across tabs. The
 * synchronous critical section narrows but cannot eliminate cross-tab races;
 * file export is still the durable user-controlled fallback.
 */
export function guardedRecoveryMutation<T>(
  storage: RecoveryPairStorage,
  keys: RecoverySlotKeys,
  expected: RecoverySnapshot | null,
  mutate: () => T,
): { readonly result: T; readonly snapshot: RecoverySnapshot } {
  if (expected === null || !sameRecoverySnapshot(captureRecoverySnapshot(storage, keys), expected)) {
    throw new RecoveryWriteConflict();
  }
  const result = mutate();
  return { result, snapshot: captureRecoverySnapshot(storage, keys) };
}
