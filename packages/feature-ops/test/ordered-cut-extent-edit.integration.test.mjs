import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('real INTENT/SKETCH/RUNTIME edits a nonterminal pocket, invalidates tail, preserves unrelated spacer and archives',()=>{
  const script=fileURLToPath(new URL('../examples/retrospective-ordered-pocket.mjs',import.meta.url));
  const run=spawnSync(process.execPath,['--experimental-strip-types',script],
    {encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr||String(run.error));
  const out=JSON.parse(run.stdout);
  assert.equal(out.consumer,'real_intent_sketch_runtime');
  assert.equal(out.pocketRevisionEdit.fromMm,3);
  assert.equal(out.pocketRevisionEdit.toMm,5);
  assert.equal(out.pocketRevisionEdit.throughAll,true);
  assert.equal(out.bracketThicknessMm,12);
  assert.equal(out.independentSpacerThicknessMm,5);
  assert.deepEqual(out.cutLineage,['cut.pocket','sketch.pocket']);
  assert.equal(out.terminalCutId,'cut.finish');
  assert.equal(out.pocketStatus,'blocked_dependency');
  assert.equal(out.terminalStatus,'blocked_dependency');
  assert.ok(out.invalidatedByPocketEdit.includes('cut.pocket'));
  assert.ok(out.invalidatedByPocketEdit.includes('cut.finish'));
  assert.ok(!out.invalidatedByPocketEdit.includes('extrude.spacer'));
  assert.ok(out.invalidatedByThicknessEdit.includes('cut.finish'));
  assert.ok(!out.invalidatedByThicknessEdit.includes('extrude.spacer'));
  assert.equal(out.undoRedoArchive,'passed');
  assert.equal(out.negativeSelections,'rejected_before_commit');
  assert.equal(out.exactAuthority,false);
  assert.equal(out.nativeBrep,'not_executed');
  assert.equal(out.step,'not_executed');
});
