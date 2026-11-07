import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,commitEvent,featuresOf,planProject} from '../src/index.ts';
import {
  startUndoHistory,undoTransaction,redoTransaction,commitUndoableTransaction,
} from '../src/transactions.ts';
import {commitUndoableParameterAuthoring} from '../src/parameter-authoring.ts';
import {commitUndoableParameterEdit} from '../src/parameter-edit.ts';
import {
  PARAMETER_FREEZE_FORMAT, previewParameterFreeze,
  commitUndoableParameterFreeze,
} from '../src/parameter-freeze.ts';
import {evaluateDimensionBindingPlan} from '../src/dimension-bindings.ts';
import {createModelArchive,serializeModelArchive,deserializeModelArchive} from '../src/archive.ts';

const literal=(value)=>({op:'literal',value,unit:'mm'});
const create=(eventId,feature)=>({eventId,type:'feature.create',feature});
const get=(doc,id)=>featuresOf(doc).find(f=>f.id===id);
const value=(doc,id,field)=>evaluateDimensionBindingPlan(planProject(doc))
  .featureGates.find(g=>g.featureId===id)?.resolvedPayload?.[field];
function plate(){
  let doc=newProject('project.parametric.freeze');
  doc=commitEvent(doc,create('create.sketch',{id:'sketch.plate',kind:'sketch',
    dependsOn:[],writeTargets:[],payload:{role:'plate.two.holes'}}));
  doc=commitEvent(doc,create('create.extrude',{id:'extrude.plate',kind:'extrude',
    dependsOn:['sketch.plate'],writeTargets:['body.plate'],
    payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}));
  doc=commitEvent(doc,create('create.cut',{id:'cut.holes',kind:'cut',
    dependsOn:['extrude.plate'],writeTargets:['body.plate'],
    payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate',depthMm:8}}));
  doc=commitEvent(doc,create('create.note',{id:'note.model',kind:'annotation',
    dependsOn:[],writeTargets:[],payload:{label:'independent'}}));
  return startUndoHistory(doc);
}
function bind(history,fields=[{featureId:'extrude.plate',field:'thicknessMm'}]){
  return commitUndoableParameterAuthoring(history,{
    format:'intuit3d.parameter-authoring',version:1,
    expectedRevision:history.document.revision,admission:'require_admissible',
    parameter:{eventId:'create.param.thickness',featureId:'parameter.thickness',
      name:'thickness',unit:'mm',expression:literal(8)},
    bindings:fields.map((f,i)=>({eventId:'bind.'+i,...f})),
  });
}
function change(history,next=12){
  return commitUndoableParameterEdit(history,{
    format:'intuit3d.parameter-edit',version:1,
    eventId:'edit.param.to'+next,featureId:'parameter.thickness',
    expectedRevision:history.document.revision,expression:literal(next),
    admission:'require_admissible',
  });
}
function freezeRequest(revision,{fields=['extrude.plate'],release=true,retire=true}={}){
  return {
    format:PARAMETER_FREEZE_FORMAT,version:1,
    expectedRevision:revision,admission:'require_admissible',
    edits:fields.map((id,i)=>({
      eventId:'freeze.unbind.'+i,featureId:id,
      field:id==='extrude.plate'?'thicknessMm':'depthMm',
    })),
    release:release?fields.map((id,i)=>({
      eventId:'freeze.release.'+i,featureId:id,
      dependencies:['parameter.thickness'],
    })):[],
    confirmIndependentIntentReviewed:release,
    retire:retire?{eventId:'freeze.retire',parameterId:'parameter.thickness'}:null,
  };
}

test('one action freezes CURRENT 12 mm, removes owned edge, retires parameter and survives undo/save/reopen',()=>{
  const original=plate();
  const bound=bind(original);
  const edited=change(bound);
  assert.equal(get(edited.document,'extrude.plate').payload.thicknessMm,8);
  assert.equal(value(edited.document,'extrude.plate','thicknessMm'),12);
  const fingerprint=JSON.stringify(edited);
  const req=freezeRequest(edited.document.revision);
  const preview=previewParameterFreeze(edited.document,req);
  assert.deepEqual(preview.baked,[{featureId:'extrude.plate',field:'thicknessMm',value:12}]);
  assert.equal(preview.released.length,1);
  assert.equal(preview.released[0].introducedByEventId,'bind.0');
  assert.equal(preview.retiredParameterId,'parameter.thickness');
  assert.equal(JSON.stringify(edited),fingerprint);
  assert.deepEqual(preview.invalidation.unchangedReady,['sketch.plate','note.model']);
  const frozen=commitUndoableParameterFreeze(edited,req);
  assert.equal(frozen.undoStack.length,edited.undoStack.length+1);
  assert.equal(get(frozen.document,'parameter.thickness'),undefined);
  assert.deepEqual(get(frozen.document,'extrude.plate').dependsOn,['sketch.plate']);
  assert.equal(get(frozen.document,'extrude.plate').payload.thicknessMm,12);
  assert.equal(get(frozen.document,'extrude.plate').payload.dimensionBindings,undefined);
  assert.equal(value(frozen.document,'extrude.plate','thicknessMm'),12);
  assert.equal(planProject(frozen.document).features.find(x=>x.feature.id==='cut.holes').status,'ready');
  const saved=serializeModelArchive(createModelArchive(frozen));
  const reopened=deserializeModelArchive(saved).history;
  assert.equal(value(reopened.document,'extrude.plate','thicknessMm'),12);
  const undone=undoTransaction(reopened,['undo.retire','undo.release','undo.unbind']);
  assert.equal(value(undone.document,'extrude.plate','thicknessMm'),12);
  assert.equal(get(undone.document,'extrude.plate').payload.thicknessMm,8);
  assert.deepEqual(get(undone.document,'extrude.plate').dependsOn,
    ['sketch.plate','parameter.thickness']);
  assert.ok(get(undone.document,'parameter.thickness'));
  const redone=redoTransaction(undone,['redo.unbind','redo.release','redo.retire']);
  assert.equal(value(redone.document,'extrude.plate','thicknessMm'),12);
  assert.equal(get(redone.document,'parameter.thickness'),undefined);
});

test('two dimensions freeze atomically while preserving unchanged sketch and body ID',()=>{
  let history=bind(plate(),[
    {featureId:'extrude.plate',field:'thicknessMm'},
    {featureId:'cut.holes',field:'depthMm'},
  ]);
  history=change(history,12);
  const req=freezeRequest(history.document.revision,{
    fields:['extrude.plate','cut.holes'],
  });
  const frozen=commitUndoableParameterFreeze(history,req);
  assert.equal(value(frozen.document,'extrude.plate','thicknessMm'),12);
  assert.equal(value(frozen.document,'cut.holes','depthMm'),12);
  assert.deepEqual(get(frozen.document,'cut.holes').dependsOn,['extrude.plate']);
  assert.deepEqual(get(frozen.document,'extrude.plate').writeTargets,['body.plate']);
  assert.deepEqual(frozen.document.journal.slice(-5).map(e=>e.type),
    ['feature.edit','feature.edit','feature.edit','feature.edit','feature.remove']);
});

test('detach without confirmation preserves every explicit edge, forbids parameter retirement',()=>{
  const edited=change(bind(plate()));
  const preserve=freezeRequest(edited.document.revision,{release:false,retire:false});
  const frozen=commitUndoableParameterFreeze(edited,preserve);
  assert.equal(value(frozen.document,'extrude.plate','thicknessMm'),12);
  assert.deepEqual(get(frozen.document,'extrude.plate').dependsOn,
    ['sketch.plate','parameter.thickness']);
  assert.ok(get(frozen.document,'parameter.thickness'));
  assert.throws(()=>previewParameterFreeze(edited.document,{
    ...freezeRequest(edited.document.revision),confirmIndependentIntentReviewed:false,
  }),/review/);
  assert.throws(()=>previewParameterFreeze(edited.document,{
    ...preserve,retire:{eventId:'retire.with.edge',parameterId:'parameter.thickness'},
  }),/still has semantic dependents/);
});

test('never erases an independently authored dependency, even when its binding was later created',()=>{
  let history=plate();
  history=commitUndoableTransaction(history,[create('param.direct',{
    id:'parameter.thickness',kind:'parameter',dependsOn:[],writeTargets:[],
    payload:{parameter:{name:'thickness',unit:'mm',expression:literal(12)}},
  })]);
  history=commitUndoableTransaction(history,[{
    eventId:'explicit.edge',type:'feature.edit',featureId:'extrude.plate',
    patch:{dependsOn:['sketch.plate','parameter.thickness']},
  }]);
  history=commitUndoableTransaction(history,[{
    eventId:'bind.independent',type:'feature.edit',featureId:'extrude.plate',
    patch:{payload:{
      ...get(history.document,'extrude.plate').payload,
      dimensionBindings:{format:'intuit3d.dimension-bindings',version:1,
        entries:[{field:'thicknessMm',unit:'mm',
          expression:{op:'ref',featureId:'parameter.thickness'}}]},
    }},
  }]);
  assert.throws(()=>previewParameterFreeze(history.document,
    freezeRequest(history.document.revision,{retire:false})),/no binding-introduction witness/);
  const frozen=commitUndoableParameterFreeze(history,
    freezeRequest(history.document.revision,{release:false,retire:false}));
  assert.equal(value(frozen.document,'extrude.plate','thicknessMm'),12);
  assert.ok(get(frozen.document,'extrude.plate').dependsOn.includes('parameter.thickness'));
});

test('strict fences: stale, unbound, unresolved and duplicate edits reject without state loss',()=>{
  const bound=bind(plate());
  const saved=JSON.stringify(bound);
  const req=freezeRequest(bound.document.revision);
  const invalid=[
    {...req,expectedRevision:req.expectedRevision-1},
    {...req,version:2},
    {...req,edits:[]},
    {...req,edits:[...req.edits,...req.edits]},
    {...req,edits:[{...req.edits[0],field:'widthMm'}]},
    {...req,retire:{eventId:req.edits[0].eventId,parameterId:'parameter.thickness'}},
    {...req,release:[{...req.release[0],dependencies:['sketch.plate']}]},
  ];
  for(const r of invalid)assert.throws(()=>commitUndoableParameterFreeze(bound,r));
  assert.equal(JSON.stringify(bound),saved);
  const pending=commitUndoableParameterEdit(bound,{
    format:'intuit3d.parameter-edit',version:1,
    eventId:'edit.unknown.param',featureId:'parameter.thickness',
    expectedRevision:bound.document.revision,
    expression:{op:'ref',featureId:'parameter.future'},
    admission:'permit_unresolved',
  });
  assert.throws(()=>previewParameterFreeze(pending.document,
    freezeRequest(pending.document.revision)),/cannot bake an unresolved/);
});
