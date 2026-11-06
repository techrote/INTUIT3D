/**
 * Integration-owned public-package consumer: SKETCH authored snap -> INTENT
 * dependency history -> one-unit archive -> recovery / undo / redo. This is
 * semantic integration only; no native B-rep, STEP, or browser claim.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {featuresOf, newProject, planProject, serializeProject} from '@intuit3d/model';
import {
  startUndoHistory, commitUndoableTransaction, undoTransaction, redoTransaction
} from '@intuit3d/model/transactions';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
  inspectModelArchiveRecovery
} from '@intuit3d/model/archive';
import {
  createSketch, solveSketch, parseSketch, serializeSketch
} from '@intuit3d/sketch';
import {suggestSketchSnaps} from '@intuit3d/sketch/snapping/v1';
import {
  proposeSnapConstraint, commitSnapConstraint
} from '@intuit3d/sketch/snap-admission/v1';

const fixture = () => createSketch({version:1, units:'mm',
  points:[{id:'moving',x:9,y:9},{id:'datum',x:0,y:0}],
  lines:[], circles:[],
  constraints:[{id:'datum-lock',kind:'fixed',point:'datum',x:0,y:0}]
});
const create = (eventId,id,dependsOn,payload) => ({
  eventId,type:'feature.create',feature:{id,kind:'fixture',dependsOn,
    writeTargets:[],payload}
});
const archive = h => serializeModelArchive(createModelArchive(h));

test('actual public sketch snap acceptance survives nonchronological semantic archive and redo',()=>{
  const source = fixture();
  const originalSketch = serializeSketch(source);
  const options = {excludeIds:['moving'],radiusMm:2};
  const snap = suggestSketchSnaps(source,{x:0,y:0},options);
  const proposal = proposeSnapConstraint(source,{
    pointId:'moving',constraintId:'snap-datum',snap,options
  });
  assert.equal(proposal.status,'admissible');
  assert.equal(proposal.previewOnly,true);
  assert.equal(solveSketch(source).status,'underconstrained');
  const constrained = commitSnapConstraint(source,proposal);
  assert.equal(solveSketch(constrained).status,'solved');
  assert.equal(serializeSketch(source),originalSketch);
  assert.ok(constrained.constraints.some(c=>c.id==='snap-datum'));

  const history = commitUndoableTransaction(startUndoHistory(newProject('product.integration')),
    [
      // Deliberately authored out of evaluation order.
      create('event.extrude','feature.extrude',['feature.sketch'],{
        thicknessMm:8,geometryProvider:'unqualified-preview'
      }),
      create('event.sketch','feature.sketch',[],{
        sketchIntent:serializeSketch(constrained)
      })
    ]);
  assert.deepEqual(featuresOf(history.document).map(f=>f.id),
    ['feature.extrude','feature.sketch']);
  assert.deepEqual(planProject(history.document).executableOrder,
    ['feature.sketch','feature.extrude']);
  const saved = archive(history);
  const reopened = deserializeModelArchive(saved);
  assert.equal(serializeModelArchive(reopened),saved);
  assert.equal(reopened.history.document.revision,2);
  const persisted = featuresOf(reopened.history.document).find(f=>f.id==='feature.sketch');
  const sketch = parseSketch(persisted.payload.sketchIntent);
  assert.equal(sketch.constraints.at(-1).id,'snap-datum');
  assert.equal(solveSketch(sketch).status,'solved');

  const undone = undoTransaction(reopened.history,['event.undo.sketch','event.undo.extrude']);
  assert.equal(featuresOf(undone.document).length,0);
  const recovered = deserializeModelArchive(archive(undone));
  const redone = redoTransaction(recovered.history,['event.redo.extrude','event.redo.sketch']);
  assert.deepEqual(planProject(redone.document).executableOrder,
    ['feature.sketch','feature.extrude']);
  assert.equal(serializeProject(reopened.history.document)===serializeProject(redone.document),false);
  assert.equal(new Set(redone.document.journal.map(e=>e.eventId)).size,6);
});

test('torn primary and newer backup are visible recovery choices, not hidden model replacement',()=>{
  const initial = startUndoHistory(newProject('product.recovery'));
  const first = commitUndoableTransaction(initial,[
    create('event.sketch','feature.sketch',[],{sketchIntent:serializeSketch(fixture())})
  ]);
  const second = commitUndoableTransaction(first,[
    create('event.extrude','feature.extrude',['feature.sketch'],{thicknessMm:8})
  ]);
  const firstSaved=archive(first),secondSaved=archive(second);
  const torn=inspectModelArchiveRecovery(secondSaved.slice(0,-13),firstSaved);
  assert.equal(torn.status,'backup_recovery');
  assert.equal(torn.primary,null);
  assert.equal(torn.backup.revision,1);
  assert.equal(inspectModelArchiveRecovery(firstSaved,secondSaved).status,'backup_ahead');
  assert.equal(inspectModelArchiveRecovery(secondSaved,firstSaved).status,'primary_current');
});

test('a stale snap cannot mutate the authored sketch or be journaled as valid',()=>{
  const source=fixture();
  const options={excludeIds:['moving']};
  const selected=suggestSketchSnaps(source,{x:0,y:0},options);
  const proposal=proposeSnapConstraint(source,{
    pointId:'moving',constraintId:'snap1',snap:selected,options
  });
  const later=structuredClone(source);
  later.points.find(p=>p.id==='moving').x=11;
  assert.throws(()=>commitSnapConstraint(later,proposal),/stale, rejected/);
  assert.equal(serializeSketch(source),selected.inputSignature);
  assert.equal(later.constraints.length,1);
});
