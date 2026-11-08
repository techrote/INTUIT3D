/**
 * A real three-body mounting assembly authored through SKETCH, FEATUREOPS and
 * Workflow RUNTIME. A face selection on the guard must not be repaired using
 * topology observations from an equal-revision but divergent gauge edit.
 * Provider reports in this fixture are explicitly synthetic, never B-rep proof.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as featureops from '@intuit3d/feature-ops';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {
  SEMANTIC_SELECTION_EDIT_FORMAT, commitUndoableSemanticSelectionEdit,
} from '../src/semantic-selection.ts';
import {TOPOLOGY_REFERENCE_FORMAT} from '../src/topology.ts';
import {
  SELECTION_REPAIR_FENCED_FORMAT, SELECTION_EVIDENCE_FENCED_FORMAT,
  previewFencedSelectionRepairBatch, commitUndoableFencedSelectionRepairBatch,
  SELECTION_INVENTORY_FENCED_FORMAT, inspectFencedSelectionInventory,
} from '../src/selection-repair.ts';

const runtime=createWorkflowRuntime({
  model,transactions,bindings,dimensions,archive,sketch,discovery,
});
const specs={
  base:{widthMm:124,depthMm:86,thicknessMm:12,
    holes:[{id:'base.left',xMm:-40,yMm:0,radiusMm:5},
      {id:'base.right',xMm:40,yMm:0,radiusMm:5}]},
  guard:{widthMm:78,depthMm:46,thicknessMm:6,
    holes:[{id:'guard.left',xMm:-22,yMm:0,radiusMm:3},
      {id:'guard.right',xMm:22,yMm:0,radiusMm:3}]},
  gauge:{widthMm:32,depthMm:18,thicknessMm:3,
    holes:[{id:'gauge.left',xMm:-9,yMm:0,radiusMm:2},
      {id:'gauge.right',xMm:9,yMm:0,radiusMm:2}]},
};
const feature=(doc,id)=>model.featuresOf(doc).find(f=>f.id===id);
const projectId='project.fenced.guard.selection';
const anchor={kind:'face',featureId:'extrude.guard',roleId:'face.outer'};
const left={...anchor,roleId:'face.outer.left'};
const right={...anchor,roleId:'face.outer.right'};

function assemble(){
  let h=transactions.startUndoHistory(model.newProject(projectId));
  for(const id of ['base','guard','gauge']){
    const s=specs[id];
    h=featureops.authorMountingFlange(h,{
      format:featureops.FEATURE_OPS_FORMAT,version:1,
      eventId:'author.'+id,expectedRevision:h.document.revision,
      sketchFeatureId:'sketch.'+id,extrudeFeatureId:'extrude.'+id,
      cutFeatureId:'cut.'+id,targetBodyId:'body.'+id,
      thicknessMm:s.thicknessMm,
      spec:{units:'mm',frame:'local_centered_xy',
        widthMm:s.widthMm,depthMm:s.depthMm,holes:s.holes},
    },{runtime,model,sketch,discovery}).history;
  }
  assert.ok(model.planProject(h.document).features.every(x=>x.status==='ready'));
  const reference={
    format:TOPOLOGY_REFERENCE_FORMAT,version:1,
    projectId,atRevision:h.document.revision,anchor,
  };
  h=commitUndoableSemanticSelectionEdit(h,{
    format:SEMANTIC_SELECTION_EDIT_FORMAT,version:1,
    eventId:'select.guard.outer.face',featureId:'cut.guard',
    field:'sourceFace',expectedRevision:h.document.revision,
    reference,admission:'require_ready',
  });
  return {h,reference};
}
function report(doc,reference){
  const steps=[];
  for(let n=reference.atRevision;n<doc.revision;n++){
    steps.push({
      projectId,fromRevision:n,toRevision:n+1,coverage:'complete',
      mappings:[{
        from:[anchor],
        to:n===doc.revision-1?[left,right]:[anchor],
        confidence:'observed',
      }],
    });
  }
  return [{
    format:SELECTION_EVIDENCE_FENCED_FORMAT,version:2,
    documentFence:model.serializeProject(doc),
    projectId,revision:doc.revision,
    featureId:'cut.guard',field:'sourceFace',
    reference,provider:'deterministic_fixture',
    snapshot:{projectId,atRevision:reference.atRevision,observedRoles:[anchor]},
    steps,
  }];
}
function repairRequest(doc){
  return {
    format:SELECTION_REPAIR_FENCED_FORMAT,version:2,
    expectedProjectId:doc.projectId,expectedRevision:doc.revision,
    expectedDocumentFence:model.serializeProject(doc),
    admission:'require_ready',
    repairs:[{
      eventId:'repair.guard.outer.face',
      featureId:'cut.guard',field:'sourceFace',selected:right,
    }],
  };
}
test('source-fenced face repair preserves independent bodies and replay while refusing divergent CAD history',()=>{
  let {h,reference}=assemble();
  const ancestor=h.document;
  const guard=feature(h.document,'extrude.guard');
  h=runtime.commit(h,[{
    type:'feature.edit',eventId:'edit.guard.thickness',
    featureId:'extrude.guard',patch:{
      payload:{...guard.payload,thicknessMm:13},
    },
  }],h.document.revision);
  const doc=h.document;
  const req=repairRequest(doc),evidence=report(doc,reference);
  const preview=previewFencedSelectionRepairBatch(doc,req,evidence);
  assert.equal(preview.repaired.length,1);
  assert.equal(preview.repaired[0].previousStatus,'requires_reconciliation');
  assert.ok(preview.invalidation.readyToEvaluate.includes('cut.guard'));
  assert.ok(preview.invalidation.unchangedReady.includes('extrude.gauge'));
  assert.ok(preview.invalidation.unchangedReady.includes('extrude.base'));
  assert.equal(preview.exactGeometryAuthority,false);
  assert.equal(preview.requiresNativeRebuild,true);
  const undoDepth=h.undoStack.length;
  h=commitUndoableFencedSelectionRepairBatch(h,req,evidence);
  assert.equal(h.undoStack.length,undoDepth+1);
  assert.equal(feature(h.document,'cut.guard').payload.sourceFace.anchor.roleId,
    'face.outer.right');
  assert.equal(feature(h.document,'extrude.gauge').payload.thicknessMm,3);
  const reopened=archive.deserializeModelArchive(
    archive.serializeModelArchive(archive.createModelArchive(h)));
  h=reopened.history;
  h=transactions.undoTransaction(h,['undo.guard.outer.face']);
  assert.equal(feature(h.document,'cut.guard').payload.sourceFace.anchor.roleId,
    'face.outer');
  h=transactions.redoTransaction(h,['redo.guard.outer.face']);
  assert.equal(feature(h.document,'cut.guard').payload.sourceFace.anchor.roleId,
    'face.outer.right');

  // Same project/revision and unchanged selection ID, but different geometry
  // authoring: the original provider observation MUST NOT cross the branch.
  const alternateGauge=feature(ancestor,'extrude.gauge');
  const branch=model.commitEvent(ancestor,{
    type:'feature.edit',eventId:'edit.gauge.alternate.branch',
    featureId:'extrude.gauge',patch:{
      payload:{...alternateGauge.payload,thicknessMm:7},
    },
  });
  assert.equal(branch.revision,doc.revision);
  assert.notEqual(model.serializeProject(branch),model.serializeProject(doc));
  assert.throws(()=>previewFencedSelectionRepairBatch(branch,req,evidence),
    model.ProjectRevisionError);
  assert.throws(()=>previewFencedSelectionRepairBatch(
    branch,repairRequest(branch),evidence),model.ProjectRevisionError);
});

function inventoryRequest(doc) {
  return {
    format: SELECTION_INVENTORY_FENCED_FORMAT, version: 2,
    expectedProjectId: doc.projectId, expectedRevision: doc.revision,
    expectedDocumentFence: model.serializeProject(doc),
  };
}

test('fenced topology inventory keeps visible repair choices tied to exact source and provider evidence', () => {
  let {h,reference} = assemble();
  const ancestor = h.document;
  const guard = feature(ancestor,'extrude.guard');
  h = runtime.commit(h,[{
    type:'feature.edit', eventId:'edit.guard.thickness.for.inventory',
    featureId:'extrude.guard',
    patch:{payload:{...guard.payload,thicknessMm:14}},
  }],ancestor.revision);
  const doc = h.document;
  const baseline = model.serializeProject(doc);
  const context = inventoryRequest(doc);
  const evidence = report(doc,reference);

  const missing = inspectFencedSelectionInventory(doc,context);
  assert.deepEqual(missing.awaitingProvider,['cut.guard.sourceFace']);
  assert.equal(missing.allReferencesObserved,false);
  assert.equal(missing.exactGeometryAuthority,false);
  const viewed = inspectFencedSelectionInventory(doc,context,evidence);
  assert.equal(viewed.format,SELECTION_INVENTORY_FENCED_FORMAT);
  assert.equal(viewed.version,2);
  assert.equal(viewed.documentFence,baseline);
  assert.deepEqual(viewed.needsUserRecovery,['cut.guard.sourceFace']);
  assert.equal(viewed.selections[0].action,'choose_successor');
  assert.deepEqual(JSON.parse(JSON.stringify(viewed.selections[0].recoveryCandidates)),
    [left,right]);
  assert.equal(viewed.selections[0].observedProvider,'deterministic_fixture');
  assert.equal(viewed.exactGeometryAuthority,false);
  assert.equal(model.serializeProject(doc),baseline,'inspection must not write journal');

  const chosen = repairRequest(doc);
  assert.equal(chosen.expectedDocumentFence,viewed.documentFence);
  const repaired = commitUndoableFencedSelectionRepairBatch(h,chosen,evidence);
  assert.equal(feature(repaired.document,'cut.guard').payload.sourceFace.anchor.roleId,
    'face.outer.right');
  assert.equal(feature(repaired.document,'extrude.gauge').payload.thicknessMm,3);
  const reopened = archive.deserializeModelArchive(archive.serializeModelArchive(
    archive.createModelArchive(repaired)));
  const rechecked = inspectFencedSelectionInventory(
    reopened.history.document,inventoryRequest(reopened.history.document));
  assert.deepEqual(rechecked.awaitingProvider,['cut.guard.sourceFace']);
  assert.equal(rechecked.exactGeometryAuthority,false);

  const gauge = feature(ancestor,'extrude.gauge');
  const branch = model.commitEvent(ancestor,{
    type:'feature.edit', eventId:'edit.gauge.instead',
    featureId:'extrude.gauge',
    patch:{payload:{...gauge.payload,thicknessMm:9}},
  });
  assert.equal(branch.revision,doc.revision);
  assert.notEqual(model.serializeProject(branch),baseline);
  assert.throws(()=>inspectFencedSelectionInventory(branch,context,evidence),
    model.ProjectRevisionError);
  assert.throws(()=>inspectFencedSelectionInventory(
    branch,inventoryRequest(branch),evidence),model.ProjectRevisionError);
  assert.throws(()=>inspectFencedSelectionInventory(doc,context,[{
    ...evidence[0],documentFence:'not-the-canonical-source',
  }]),model.ProjectRevisionError);
  assert.throws(()=>inspectFencedSelectionInventory(doc,context,[{
    ...evidence[0],format:'intuit3d.selection-evidence',version:1,
  }]),model.ProjectFormatError);
  assert.throws(()=>inspectFencedSelectionInventory(doc,{
    ...context,expectedRevision:doc.revision-1,
  },evidence),model.ProjectRevisionError);
  assert.throws(()=>inspectFencedSelectionInventory(doc,{
    ...context,unsupported:true,
  },evidence),model.ProjectFormatError);
  assert.equal(model.serializeProject(doc),baseline);
});
