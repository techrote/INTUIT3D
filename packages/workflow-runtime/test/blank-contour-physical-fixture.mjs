/**
 * Shared REAL INTENT/SKETCH source for the optional pinned-C++ from-empty demo.
 * No browser gestures or native geometry are executed in this module.
 * The live Runtime session is the only mutating journal authority.
 */
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as sketch from '@intuit3d/sketch';
import {createClosedContour,editClosedContourVertices}
  from '@intuit3d/sketch/closed-contour-authoring/v1';
import {CLOSED_CONTOUR_TRANSACTION_FORMAT} from '../index.mjs';

const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
const vertices=(width)=>[
  {x:0,y:0},{x:width,y:0},{x:width,y:80},{x:0,y:80},
];

export function blankNativePlateHistory(runtime,projectId='runtime.occt8.from.empty') {
  const source=sketch.validateSketch({version:1,units:'mm',
    points:[],lines:[],circles:[],constraints:[]});
  const initial=runtime.commit(
    transactions.startUndoHistory(model.newProject(projectId)),[
      created('native.blank.sketch',{id:'sketch.plate',kind:'sketch',
        dependsOn:[],writeTargets:[],payload:{sketch:source}}),
    ]);
  // Source SKETCH creation is a baseline; user contour edits are undoable.
  return transactions.startUndoHistory(initial.document);
}
function sourceSketch(session,runtime) {
  const history=runtime.reopen(session.save());
  const feature=model.featuresOf(history.document).find(x=>x.id==='sketch.plate');
  assert.equal(feature?.kind,'sketch');
  return sketch.validateSketch(feature.payload.sketch);
}
function submit(session,kind,payload) {
  const state=session.refresh();
  const result=session.applyCommand({kind,projectId:state.projectId,
    expectedRevision:state.revision,...payload});
  assert.equal(result.kind,'committed',JSON.stringify(result));
  return result;
}
function contourCommand(session,runtime,operation,command,acceptance,selection) {
  assert.equal(acceptance.kind,'accepted',JSON.stringify(acceptance));
  const doc=sourceSketch(session,runtime);
  return submit(session,'sketch.contour/v1',{request:{
    format:CLOSED_CONTOUR_TRANSACTION_FORMAT,version:1,
    sketchFeatureId:'sketch.plate',
    eventId:'native.drawn.'+operation+'.'+session.refresh().revision,
    expectedArchive:session.save(),
    expectedSketchSignature:sketch.serializeSketch(doc),
    operation,command,acceptance,...(selection?{selection}:{})
  }});
}
/** One genuine empty-source contour, two admitted circles, targeted body cut. */
export function authorBlankNativePlate(session,runtime) {
  const before=session.save();
  const source=sourceSketch(session,runtime);
  assert.deepEqual(source.points,[]);
  assert.deepEqual(source.lines,[]);
  assert.deepEqual(source.circles,[]);
  const signature=sketch.serializeSketch(source);
  const command={kind:'create-closed-contour',version:1,sourceSignature:signature,
    contourId:'drawn.outline',vertices:vertices(120)};
  const accepted=createClosedContour(source,command);
  const committed=contourCommand(session,runtime,'create',command,accepted);
  assert.equal(committed.contourReceipt?.selection.sourceSignature,
    accepted.nextSourceSignature);
  assert.equal(session.currentStep(),null);
  submit(session,'sketch.holes',{request:{
    sketchFeatureId:'sketch.plate',eventId:'native.drawn.holes',
    admission:'require_admissible',
    operations:[
      {kind:'add',id:'holeA',x:35,y:40,radius:6},
      {kind:'add',id:'holeB',x:85,y:40,radius:6},
    ],
  }});
  submit(session,'model.events',{events:[
    created('native.drawn.extrude',{id:'plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    created('native.drawn.cut',{id:'cut',kind:'cut',
      dependsOn:['plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]});
  const report=runtime.inspect(runtime.reopen(session.save()));
  assert.equal(report.features.find(x=>x.featureId==='cut').status,
    'pending_exact_provider');
  return {blankArchive:before,sourceArchive:session.save(),
    contourReceipt:committed.contourReceipt};
}
/** Retrospective 120 -> 150 mm solver-authored outer contour edit. */
export function widenBlankNativePlate(session,runtime,receipt) {
  const source=sourceSketch(session,runtime);
  const signature=sketch.serializeSketch(source);
  const selection={...receipt.selection,sourceSignature:signature};
  const command={kind:'edit-closed-contour-vertices',version:1,
    sourceSignature:signature,contourId:'drawn.outline',
    changes:[{index:1,xMm:150,yMm:0},{index:2,xMm:150,yMm:80}]};
  const accepted=editClosedContourVertices(source,selection,command);
  const changed=contourCommand(session,runtime,'edit',command,accepted,selection);
  assert.deepEqual(changed.invalidation.invalidatedFeatureIds,
    ['sketch.plate','plate','cut']);
  assert.equal(sourceSketch(session,runtime).circles.length,2);
  assert.equal(session.currentStep(),null);
  return changed;
}
