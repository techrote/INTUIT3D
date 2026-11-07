import test from 'node:test';
import assert from 'node:assert/strict';
import {runCreateBindReplay} from '../examples/create-bind-replay.mjs';

test('public INTENT/SKETCH/RUNTIME consumer creates parameter, edits 8→12 and reopens with undo',()=>{
  const r=runCreateBindReplay();
  assert.equal(r.projectId,'demo.create.bind.replay');
  assert.equal(r.parameterId,'parameter.thickness');
  assert.equal(r.fromThicknessMm,8);
  assert.equal(r.toThicknessMm,12);
  assert.equal(r.editedRevision,r.authoredRevision+1);
  assert.deepEqual(r.invalidatedAfterParameterEdit,
    ['extrude.plate','cut.holes','parameter.thickness']);
  assert.equal(r.unaffectedSketch,true);
  assert.equal(r.cutStatus,'pending_exact_provider');
  assert.equal(r.exactGeometryAvailable,false);
  assert.equal(r.archiveRoundtrip,true);
  assert.equal(r.undoRedo,true);
});
