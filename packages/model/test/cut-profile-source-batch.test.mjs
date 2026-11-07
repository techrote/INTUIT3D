import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitEvent, featuresOf, newProject, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from '../src/index.ts';
import {
  startUndoHistory, undoTransaction, redoTransaction, serializeUndoHistory,
} from '../src/transactions.ts';
import {
  createModelArchive, serializeModelArchive, deserializeModelArchive,
} from '../src/archive.ts';
import { planIncrementalEvaluation } from '../src/incremental.ts';
import {
  CUT_PROFILE_SOURCE_BATCH_FORMAT, CUT_PROFILE_SOURCE_BATCH_VERSION,
  previewCutProfileSourceBatch, commitUndoableCutProfileSourceBatch,
} from '../src/cut-profile-source.ts';

const creation = (id, kind, dependsOn, writeTargets, payload) => ({
  eventId: 'create.' + id, type: 'feature.create',
  feature: { id, kind, dependsOn, writeTargets, payload },
});
const living = (doc, id) => featuresOf(doc).find((f) => f.id === id);
const status = (doc, id) => planProject(doc).features.find((f) => f.feature.id === id)?.status;

function fixture({ extraDependent = false } = {}) {
  let doc = newProject('project.multi.bore.replace');
  const add = (id,kind,deps,targets,payload) => {
    doc = commitEvent(doc, creation(id,kind,deps,targets,payload));
  };
  add('sketch.plate','sketch',[],['sketch.plate'],{
    widthMm:120,heightMm:80,profileId:'cycle:plate',
  });
  add('sketch.old.bores','sketch',[],['sketch.old.bores'],{
    diameterMm:10,profileId:'cycle:old',
  });
  add('feature.extrude','extrude',['sketch.plate'],['body.plate'],{
    sourceSketchId:'sketch.plate',thicknessMm:8,
  });
  add('feature.bore.left','cut',
    ['feature.extrude','sketch.old.bores'],['body.plate'],{
      sourceSketchId:'sketch.old.bores',targetBodyId:'body.plate',
      profileCandidateId:'cycle:old.left',throughAll:true,
    });
  add('feature.bore.right','cut',
    ['feature.bore.left','sketch.old.bores'],['body.plate'],{
      sourceSketchId:'sketch.old.bores',targetBodyId:'body.plate',
      profileCandidateId:'cycle:old.right',throughAll:true,
    });
  add('feature.pocket','cut',
    ['feature.bore.right','sketch.plate'],['body.plate'],{
      sourceSketchId:'sketch.plate',targetBodyId:'body.plate',
      profileCandidateId:'cycle:pocket',throughAll:false,depthMm:3,
    });
  add('feature.spacer','extrude',[],['body.spacer'],{thicknessMm:4});
  if (extraDependent) {
    add('feature.unrepaired','note',['sketch.old.bores'],[],{name:'uses old sketch'});
  }
  return doc;
}

function request(doc, changes={}) {
  return {
    format:CUT_PROFILE_SOURCE_BATCH_FORMAT,
    version:CUT_PROFILE_SOURCE_BATCH_VERSION,
    expectedProjectId:doc.projectId,
    expectedRevision:doc.revision,
    admission:'require_ready',
    replacementSketch:{
      eventId:'create.sketch.new.bores',
      feature:{
        id:'sketch.new.bores',kind:'sketch',dependsOn:[],
        writeTargets:['sketch.new.bores'],
        payload:{diameterMm:14,profileId:'cycle:new.bores'},
      },
    },
    edits:[
      {
        eventId:'edit.bore.left',cutFeatureId:'feature.bore.left',
        targetBodyId:'body.plate',
        expectedSourceSketchId:'sketch.old.bores',
        expectedProfileCandidateId:'cycle:old.left',
        sourceSketchId:'sketch.new.bores',
        profileCandidateId:'cycle:new.left',
        releasePreviousSketchDependency:true,
      },
      {
        eventId:'edit.bore.right',cutFeatureId:'feature.bore.right',
        targetBodyId:'body.plate',
        expectedSourceSketchId:'sketch.old.bores',
        expectedProfileCandidateId:'cycle:old.right',
        sourceSketchId:'sketch.new.bores',
        profileCandidateId:'cycle:new.right',
        releasePreviousSketchDependency:true,
      },
    ],
    retireSketch:{eventId:'retire.old.bores',featureId:'sketch.old.bores'},
    ...changes,
  };
}

test('one transaction authors replacement sketch, retargets two ordered cuts, retires unused old sketch',()=>{
  const before=fixture(), frozen=serializeProject(before);
  const staged=previewCutProfileSourceBatch(before,request(before));
  assert.equal(staged.document.revision,before.revision+4);
  assert.deepEqual(staged.editedCutIds,['feature.bore.left','feature.bore.right']);
  assert.deepEqual(staged.cutStatuses,[
    {featureId:'feature.bore.left',status:'ready'},
    {featureId:'feature.bore.right',status:'ready'},
  ]);
  assert.equal(staged.newlyAuthoredSketchId,'sketch.new.bores');
  assert.equal(staged.retiredSketchId,'sketch.old.bores');
  assert.equal(living(staged.document,'sketch.old.bores'),undefined);
  assert.equal(living(staged.document,'sketch.new.bores').payload.diameterMm,14);
  assert.deepEqual(living(staged.document,'feature.bore.left').dependsOn,
    ['feature.extrude','sketch.new.bores']);
  assert.deepEqual(living(staged.document,'feature.bore.right').dependsOn,
    ['feature.bore.left','sketch.new.bores']);
  assert.equal(living(staged.document,'feature.bore.left').payload.profileCandidateId,'cycle:new.left');
  assert.equal(living(staged.document,'feature.bore.right').payload.profileCandidateId,'cycle:new.right');
  assert.equal(living(staged.document,'feature.bore.right').payload.targetBodyId,'body.plate');
  assert.equal(status(staged.document,'feature.pocket'),'ready');
  for(const id of ['feature.bore.left','feature.bore.right','feature.pocket'])
    assert.ok(staged.invalidation.readyToEvaluate.includes(id),id);
  assert.ok(staged.invalidation.retiredFeatureIds.includes('sketch.old.bores'));
  assert.ok(staged.invalidation.unchangedReady.includes('feature.spacer'));
  assert.equal(staged.requiresSketchAdmission,true);
  assert.equal(staged.requiresNativeRebuild,true);
  assert.equal(staged.exactGeometryAuthority,false);
  assert.equal(serializeProject(before),frozen);
});

test('all four journal commands are one undo/redo frame surviving save/reopen and early plate dimension edits',()=>{
  const before=fixture();
  let history=commitUndoableCutProfileSourceBatch(startUndoHistory(before),request(before));
  assert.equal(history.undoStack.length,1);
  assert.equal(history.document.revision,before.revision+4);
  history=deserializeModelArchive(
    serializeModelArchive(createModelArchive(history))).history;
  history=undoTransaction(history,[
    'undo.retire.old','undo.right','undo.left','undo.create.new',
  ]);
  assert.equal(status(history.document,'feature.bore.left'),'ready');
  assert.equal(living(history.document,'sketch.new.bores'),undefined);
  assert.ok(living(history.document,'sketch.old.bores'));
  assert.equal(living(history.document,'feature.bore.left').payload.sourceSketchId,'sketch.old.bores');
  assert.equal(living(history.document,'feature.bore.right').payload.profileCandidateId,'cycle:old.right');
  history=redoTransaction(history,[
    'redo.create.new','redo.left','redo.right','redo.retire.old',
  ]);
  assert.equal(status(history.document,'feature.pocket'),'ready');
  assert.equal(living(history.document,'sketch.old.bores'),undefined);
  assert.equal(living(history.document,'feature.bore.left').payload.profileCandidateId,'cycle:new.left');
  assert.equal(history.undoStack.length,1);

  const active=history.document;
  const widened=commitEvent(active,{
    eventId:'edit.plate.width',type:'feature.edit',featureId:'sketch.plate',
    patch:{payload:{widthMm:150,heightMm:80,profileId:'cycle:plate'}},
  });
  const incremental=planIncrementalEvaluation(active,widened);
  for(const id of ['feature.extrude','feature.bore.left','feature.bore.right','feature.pocket'])
    assert.ok(incremental.readyToEvaluate.includes(id),id);
  assert.ok(incremental.unchangedReady.includes('feature.spacer'));
  assert.ok(incremental.unchangedReady.includes('sketch.new.bores'));
});

test('source retirement refuses to orphan a third active consumer: no partial journal or history mutation',()=>{
  const doc=fixture({extraDependent:true}), session=startUndoHistory(doc);
  const frozen=serializeUndoHistory(session);
  assert.throws(()=>commitUndoableCutProfileSourceBatch(session,request(doc)),
    /still used by feature.unrepaired/);
  assert.equal(serializeUndoHistory(session),frozen);
  const partial=previewCutProfileSourceBatch(doc,request(doc,{retireSketch:undefined}));
  assert.equal(status(partial.document,'feature.unrepaired'),'ready');
  assert.ok(living(partial.document,'sketch.old.bores'));
});

test('wrong cut/source/body, duplicate edit, missing sketch and stale revision fail atomically',()=>{
  const doc=fixture(), session=startUndoHistory(doc);
  const frozen=serializeUndoHistory(session);
  const base=request(doc);
  const invalid=[
    {expectedRevision:doc.revision-1},
    {expectedProjectId:'project.foreign'},
    {edits:[base.edits[0],base.edits[0]]},
    {edits:[{...base.edits[0],expectedProfileCandidateId:'cycle:wrong'},base.edits[1]]},
    {edits:[{...base.edits[0],targetBodyId:'body.spacer'},base.edits[1]]},
    {edits:[{...base.edits[0],cutFeatureId:'feature.extrude'},base.edits[1]]},
    {edits:[{...base.edits[0],sourceSketchId:'sketch.absent'},base.edits[1]]},
    {edits:[{...base.edits[0],profileCandidateId:'face:3'},base.edits[1]]},
    {edits:[{...base.edits[0],releasePreviousSketchDependency:false},base.edits[1]]},
    {retireSketch:{eventId:'edit.bore.left',featureId:'sketch.old.bores'}},
    {replacementSketch:{eventId:'create.extra',feature:{
      id:'sketch.unselected',kind:'sketch',dependsOn:[],
      writeTargets:['sketch.unselected'],payload:{},
    }}},
  ];
  for(const overrides of invalid) {
    assert.throws(()=>commitUndoableCutProfileSourceBatch(session,request(doc,overrides)),
      (error)=>error instanceof ProjectFormatError ||
        error instanceof ProjectRevisionError);
    assert.equal(serializeUndoHistory(session),frozen);
  }
});

test('cycle in newly authored replacement sketch cannot become a valid cut/STEP',()=>{
  const doc=fixture();
  const base=request(doc), sketch=base.replacementSketch.feature;
  assert.throws(()=>previewCutProfileSourceBatch(doc,request(doc,{
    replacementSketch:{...base.replacementSketch,feature:{
      ...sketch,dependsOn:['feature.bore.left'],
    }},
  })),/retargeted cut is not dependency-ready|regresses previously ready/);
});

test('batch demonstration runs as public model code',async()=>{
  await import('../examples/atomic-multi-cut-profile-replacement.mjs');
});
