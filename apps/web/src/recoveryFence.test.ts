import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RecoveryWriteConflict, captureRecoverySnapshot, guardedRecoveryMutation, sameRecoverySnapshot,
  type RecoverySlotKeys,
} from './recoveryFence.ts';

const keys: RecoverySlotKeys = { current: 'current', previous: 'previous' };
class Storage {
  private values = new Map<string, string>();
  readonly writes: string[] = [];
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(key); this.values.set(key, value); }
  removeItem(key: string) { this.writes.push(key); this.values.delete(key); }
}

function rotate(storage: Storage, next: string) {
  const current = storage.getItem(keys.current);
  if (current !== null) storage.setItem(keys.previous, current);
  storage.setItem(keys.current, next);
}

test('two tabs starting empty: stale second tab cannot overwrite the first draft', () => {
  const storage = new Storage();
  const tabA = captureRecoverySnapshot(storage, keys);
  const tabB = captureRecoverySnapshot(storage, keys);
  const afterA = guardedRecoveryMutation(storage, keys, tabA, () => rotate(storage, 'revision-a')).snapshot;
  assert.equal(afterA.current, 'revision-a');
  const before = storage.writes.length;
  assert.throws(() => guardedRecoveryMutation(storage, keys, tabB, () => rotate(storage, 'revision-b')), RecoveryWriteConflict);
  assert.equal(storage.writes.length, before);
  assert.deepEqual(captureRecoverySnapshot(storage, keys), afterA);
});

test('own edits advance the snapshot and preserve the previous recovery slot', () => {
  const storage = new Storage();
  let expected = captureRecoverySnapshot(storage, keys);
  expected = guardedRecoveryMutation(storage, keys, expected, () => rotate(storage, 'v1')).snapshot;
  expected = guardedRecoveryMutation(storage, keys, expected, () => rotate(storage, 'v2')).snapshot;
  assert.deepEqual(expected, { current: 'v2', previous: 'v1' });
  assert.equal(sameRecoverySnapshot(expected, captureRecoverySnapshot(storage, keys)), true);
});

test('guard detects changes to previous slot even if newest revision is unchanged', () => {
  const storage = new Storage();
  rotate(storage, 'v1');
  rotate(storage, 'v2');
  const token = captureRecoverySnapshot(storage, keys);
  storage.setItem(keys.previous, 'different-backup');
  const count = storage.writes.length;
  assert.throws(() => guardedRecoveryMutation(storage, keys, token, () => rotate(storage, 'v3')), RecoveryWriteConflict);
  assert.equal(storage.writes.length, count);
  assert.equal(storage.getItem(keys.current), 'v2');
});

test('stale discard must not remove a newer draft', () => {
  const storage = new Storage();
  rotate(storage, 'owner-draft');
  const old = captureRecoverySnapshot(storage, keys);
  rotate(storage, 'other-tab');
  assert.throws(() => guardedRecoveryMutation(storage, keys, old, () => {
    storage.removeItem(keys.current);
    storage.removeItem(keys.previous);
  }), RecoveryWriteConflict);
  assert.equal(storage.getItem(keys.current), 'other-tab');
});

test('null/unknown baseline fails closed without invoking the mutation', () => {
  const storage = new Storage();
  let called = false;
  assert.throws(() => guardedRecoveryMutation(storage, keys, null, () => { called = true; }), RecoveryWriteConflict);
  assert.equal(called, false);
});

test('existing corrupt bytes are never normalised or discarded by an unsuccessful guard', () => {
  const storage = new Storage();
  storage.setItem(keys.current, '{broken');
  const initial = captureRecoverySnapshot(storage, keys);
  storage.setItem(keys.previous, '{also-broken');
  assert.throws(() => guardedRecoveryMutation(storage, keys, initial, () => storage.removeItem(keys.current)), RecoveryWriteConflict);
  assert.equal(storage.getItem(keys.current), '{broken');
  assert.equal(storage.getItem(keys.previous), '{also-broken');
});

test('read errors and writer errors propagate instead of being treated as successful saves', () => {
  const bad = { getItem: (_key: string): string | null => { throw new Error('SecurityError'); } };
  assert.throws(() => captureRecoverySnapshot(bad, keys), /SecurityError/);
  const storage = new Storage();
  const initial = captureRecoverySnapshot(storage, keys);
  assert.throws(() => guardedRecoveryMutation(storage, keys, initial, () => { throw new Error('QuotaExceededError'); }), /QuotaExceededError/);
});
