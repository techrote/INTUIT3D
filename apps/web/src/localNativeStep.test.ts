import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCurrentStepRevision,experimentalStepFilename,sourceBoundStepFilename} from './localNativeStep.ts';

test('an unchanged authoritative archive and exact project/revision may publish verified bytes',()=>{
  const current={document:{projectId:'plate.alpha',revision:5},journal:['a']};
  const serialize=(value:typeof current)=>JSON.stringify(value);
  const archive=serialize(current);
  assert.equal(verifyCurrentStepRevision({originalArchive:archive,
    readCurrentHistory:()=>current,serialize,source:{projectId:'plate.alpha',revision:5}}),true);
  const reopened=JSON.parse(archive) as typeof current;
  assert.equal(verifyCurrentStepRevision({originalArchive:archive,
    readCurrentHistory:()=>reopened,serialize,source:{projectId:'plate.alpha',revision:5}}),true);
});

test('final publication fence blocks edit, undo/replay mismatch and reused revision',()=>{
  const source={projectId:'plate.alpha',revision:5};
  const initial={document:source,journal:['a']};
  const serialize=(value:typeof initial)=>JSON.stringify(value);
  const originalArchive=serialize(initial);
  const changed={document:{...source,revision:6},journal:['a','edit']};
  const forgedSameRevision={document:source,journal:['a','different']};
  for (const current of [changed,forgedSameRevision,{...initial,document:{projectId:'plate.beta',revision:5}}]){
    assert.equal(verifyCurrentStepRevision({originalArchive,serialize,source,
      readCurrentHistory:()=>current}),false);
  }
  assert.equal(verifyCurrentStepRevision({originalArchive,serialize,source,
    readCurrentHistory:()=>{throw Error('archive lost');}}),false);
});

test('STEP filename never imports project IDs as paths and carries experimental provenance',()=>{
  assert.equal(experimentalStepFilename('../a/b:c',12),'___a_b_c-revision-12-experimental.step');
  assert.ok(experimentalStepFilename('x'.repeat(100),3).length<110);
  assert.throws(()=>experimentalStepFilename('plate',-1));
});

test('download filename states ONLY the backend of a source-bound RUNTIME receipt',()=>{
  assert.equal(sourceBoundStepFilename('plate.alpha',11,'OCCT-cxx-8.0.1'),
    'plate_alpha-revision-11-pinned-occt8-cxx.step');
  assert.equal(sourceBoundStepFilename('plate.alpha',11,'OCP-python-prototype'),
    'plate_alpha-revision-11-experimental.step');
  assert.equal(sourceBoundStepFilename('../a/b:c',12,'OCCT-cxx-8.0.1'),
    '___a_b_c-revision-12-pinned-occt8-cxx.step');
  assert.throws(()=>sourceBoundStepFilename('plate',1,'other' as 'OCCT-cxx-8.0.1'),
    /Unrecognized source-bound STEP backend/);
  assert.throws(()=>sourceBoundStepFilename('plate',-1,'OCCT-cxx-8.0.1'),
    /Invalid STEP filename identity/);
});
