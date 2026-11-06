import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RECOVERY_CURRENT_KEY, RECOVERY_PREVIOUS_KEY, discardRecovery,
  inspectRecovery, persistRecovery, type RecoveryStorage,
} from './recovery.ts';

class MemoryStorage implements RecoveryStorage {
  readonly entries = new Map<string, string>();
  failWritesFor: string | null = null;
  getItem(key: string): string | null { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWritesFor === key) throw new Error('QuotaExceededError');
    this.entries.set(key, value);
  }
  removeItem(key: string): void { this.entries.delete(key); }
}

// Production passes the full versioned preview parseDocument validator.
const parse = (source: string): { revision: number; valid?: boolean } => {
  const value: unknown = JSON.parse(source);
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    !('revision' in value) || !Number.isSafeInteger(value.revision) ||
    !('format' in value) || value.format !== 'intuit3d.web-preview') {
    throw new Error('Invalid project');
  }
  return value as { revision: number; valid?: boolean };
};
const json = (revision: number, valid = true) => JSON.stringify({ format: 'intuit3d.web-preview', revision, valid });

test('fresh storage has no draft; saving and reopening recovers exactly the stored document', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(inspectRecovery(() => storage, parse), { kind: 'none' });
  assert.equal(persistRecovery(() => storage, json(4), parse, 1500), 'written');
  assert.deepEqual(inspectRecovery(() => storage, parse), {
    kind: 'available', document: parse(json(4)), slot: 'current', savedAt: 1500, warning: null,
  });
});

test('unchanged content does not churn timestamps or previous slot', () => {
  const storage = new MemoryStorage();
  persistRecovery(() => storage, json(1), parse, 123);
  const current = storage.getItem(RECOVERY_CURRENT_KEY);
  assert.equal(persistRecovery(() => storage, json(1), parse, 987), 'unchanged');
  assert.equal(storage.getItem(RECOVERY_CURRENT_KEY), current);
  assert.equal(storage.getItem(RECOVERY_PREVIOUS_KEY), null);
});

test('older last-known-good snapshot survives accidental truncation of current', () => {
  const storage = new MemoryStorage();
  persistRecovery(() => storage, json(7), parse, 100);
  persistRecovery(() => storage, json(8), parse, 200);
  storage.entries.set(RECOVERY_CURRENT_KEY, '{"truncated":');
  const recovered = inspectRecovery(() => storage, parse);
  assert.equal(recovered.kind, 'available');
  if (recovered.kind !== 'available') throw new Error('expected available');
  assert.equal(recovered.slot, 'previous');
  assert.equal(recovered.document.revision, 7);
  assert.match(recovered.warning ?? '', /damaged/);
});

test('tampered checksum and schema and inner document fail closed', () => {
  const storage = new MemoryStorage();
  persistRecovery(() => storage, json(9), parse, 90);
  const parsed = JSON.parse(storage.getItem(RECOVERY_CURRENT_KEY)!) as Record<string, unknown>;
  storage.entries.set(RECOVERY_CURRENT_KEY, JSON.stringify({ ...parsed, checksum: '00000000' }));
  assert.equal(inspectRecovery(() => storage, parse).kind, 'corrupt');
  storage.entries.set(RECOVERY_CURRENT_KEY, JSON.stringify({ ...parsed, version: 4 }));
  assert.equal(inspectRecovery(() => storage, parse).kind, 'corrupt');
  storage.entries.set(RECOVERY_CURRENT_KEY, JSON.stringify({ ...parsed, previewJson: '[]' }));
  assert.equal(inspectRecovery(() => storage, parse).kind, 'corrupt');
});

test('quota failure cannot destroy the current valid snapshot', () => {
  const storage = new MemoryStorage();
  persistRecovery(() => storage, json(10), parse, 10);
  storage.failWritesFor = RECOVERY_CURRENT_KEY;
  assert.throws(() => persistRecovery(() => storage, json(11), parse, 11), /QuotaExceeded/);
  const result = inspectRecovery(() => storage, parse);
  assert.equal(result.kind, 'available');
  if (result.kind !== 'available') throw new Error('expected available');
  assert.equal(result.document.revision, 10);
});

test('invalid new document cannot replace a valid recovery snapshot', () => {
  const storage = new MemoryStorage();
  persistRecovery(() => storage, json(12), parse, 100);
  assert.throws(() => persistRecovery(() => storage, '{"revision":13}', parse, 101), /Invalid project/);
  const result = inspectRecovery(() => storage, parse);
  assert.equal(result.kind, 'available');
  if (result.kind !== 'available') throw new Error('expected available');
  assert.equal(result.document.revision, 12);
});

test('invalid geometry is recoverable as editable intent, never certified geometry', () => {
  const storage = new MemoryStorage();
  persistRecovery(() => storage, json(13, false), parse, 100);
  const result = inspectRecovery(() => storage, parse);
  assert.equal(result.kind, 'available');
  if (result.kind !== 'available') throw new Error('expected available');
  assert.equal(result.document.valid, false);
});

test('blocked browser storage reports unavailability', () => {
  assert.equal(inspectRecovery(() => { throw new Error('SecurityError'); }, parse).kind, 'unavailable');
});

test('invalid slots cannot be silently reset without an explicit discard', () => {
  const storage = new MemoryStorage();
  storage.setItem(RECOVERY_CURRENT_KEY, '{');
  storage.setItem(RECOVERY_PREVIOUS_KEY, '{}');
  assert.equal(inspectRecovery(() => storage, parse).kind, 'corrupt');
  assert.ok(storage.getItem(RECOVERY_CURRENT_KEY));
  discardRecovery(() => storage);
  assert.equal(inspectRecovery(() => storage, parse).kind, 'none');
});

test('unknown envelope fields, oversized snapshots and impossible timestamps fail closed', () => {
  const storage = new MemoryStorage();
  persistRecovery(() => storage, json(2), parse, 100);
  const raw = JSON.parse(storage.getItem(RECOVERY_CURRENT_KEY)!) as object;
  storage.entries.set(RECOVERY_CURRENT_KEY, JSON.stringify({ ...raw, injected: true }));
  assert.equal(inspectRecovery(() => storage, parse).kind, 'corrupt');
  assert.throws(() => persistRecovery(() => storage, 'x'.repeat(1024 * 1024 + 1), parse), /capacity/);
  assert.throws(() => persistRecovery(() => storage, json(3), parse, -1), /timestamp/);
});
