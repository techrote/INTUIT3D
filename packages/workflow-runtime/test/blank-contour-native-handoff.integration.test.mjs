/**
 * Product-critical RUNTIME composition test: user-authored EMPTY sketch ->
 * accepted SKETCH contour -> source-bound INTENT journal -> authored hole ->
 * target-bound extrusion/cut -> the real KERNEL plate-v1 request contract.
 *
 * This tests application/command assembly using a SYNTHETIC pinned provider.
 * It is NOT C++ execution, an exact B-rep, an independently imported STEP,
 * or graphical pointer acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import * as plateContract from '@intuit3d/kernel-contract/plate-v1';
import {createClosedContour,editClosedContourVertices} from '@intuit3d/sketch/closed-contour-authoring/v1';
import {createWorkflowRuntime,CLOSED_CONTOUR_TRANSACTION_FORMAT} from '../index.mjs';
import {createLivePlateSession} from '../live-plate-session.mjs';
import {createExperimentalPlateWorkflow} from '../experimental-plate.mjs';

const runtime=createWorkflowRuntime({model,transactions,bindings,dimensions,archive,sketch,discovery});
const event=(eventId,feature)=>({eventId,type:'feature.create',feature});
const rectangle=(width=120)=>[
  {x:0,y:0},{x:width,y:0},{x:width,y:80},{x:0,y:80},
];
function emptyProject(eventId='seed.sketch') {
  const blank=sketch.validateSketch({version:1,units:'mm',
    points:[],lines:[],circles:[],constraints:[]});
  const seed=runtime.commit(
    transactions.startUndoHistory(model.newProject('runtime.blank.native.handoff')),
    [event(eventId,{id:'sketch.plate',kind:'sketch',dependsOn:[],
      writeTargets:[],payload:{sketch:blank}})]);
  // A blank project is a baseline; only actual user edits occupy undo frames.
  return transactions.startUndoHistory(seed.document);
}
function live(initial=emptyProject()) {
  let history=initial;
  const session=createLivePlateSession({runtime,
    readCurrentHistory:()=>history,publishHistory:next=>{history=next;}});
  return {session,get history(){return history;}};
}
function currentSketch(history) {
  return sketch.validateSketch(model.featuresOf(history.document)
    .find(feature=>feature.id==='sketch.plate').payload.sketch);
}
function send(session,kind,payload) {
  const state=session.refresh();
  return session.applyCommand({kind,projectId:state.projectId,
    expectedRevision:state.revision,...payload});
}
function contour(source,operation,{vertices,changes,selection}={}) {
  const doc=currentSketch(source.history),stamp=sketch.serializeSketch(doc);
  const command=operation==='create'
    ?{kind:'create-closed-contour',version:1,sourceSignature:stamp,
      contourId:'user.rectangle',vertices:vertices??rectangle()}
    :{kind:'edit-closed-contour-vertices',version:1,sourceSignature:stamp,
      contourId:'user.rectangle',changes};
  const chosen=operation==='create'?undefined:{...selection,sourceSignature:stamp};
  const acceptance=operation==='create'
    ?createClosedContour(doc,command)
    :editClosedContourVertices(doc,chosen,command);
  assert.equal(acceptance.kind,'accepted',JSON.stringify(acceptance));
  const commandResult=send(source.session,'sketch.contour/v1',{request:{
    format:CLOSED_CONTOUR_TRANSACTION_FORMAT,version:1,
    expectedArchive:source.session.save(),expectedSketchSignature:stamp,
    sketchFeatureId:'sketch.plate',eventId:'contour.'+source.history.document.revision,
    operation,command,acceptance,...(chosen?{selection:chosen}:{})
  }});
  assert.equal(commandResult.kind,'committed',JSON.stringify(commandResult));
  assert.equal(commandResult.contourReceipt.selection.sourceSignature,
    acceptance.nextSourceSignature);
  return commandResult;
}
function addBore(source){
  const result=send(source.session,'sketch.holes',{request:{
    sketchFeatureId:'sketch.plate',eventId:'user.bore.add',
    admission:'require_admissible',
    operations:[{kind:'add',id:'user.bore',x:35,y:40,radius:6}],
  }});
  assert.equal(result.kind,'committed',JSON.stringify(result));
  assert.equal(result.report.features.find(f=>f.featureId==='sketch.plate').status,
    'analytic_profile_only');
  return result;
}
function addSolidAndCut(source) {
  const result=send(source.session,'model.events',{events:[
    event('user.extrusion',{id:'plate',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:8}}),
    event('user.cut',{id:'cut',kind:'cut',
      dependsOn:['plate'],writeTargets:['body.plate'],
      payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.plate'}}),
  ]});
  assert.equal(result.kind,'committed');
  assert.equal(result.report.features.find(f=>f.featureId==='cut').status,
    'pending_exact_provider');
}
function syntheticPinnedProvider(log) {
  return async(request,options)=>{
    log.push(structuredClone(request));
    assert.deepEqual(plateContract.parsePlateRequest(request),request);
    assert.equal(options.readCurrentRevision(),request.revision);
    // Derived from the actual versioned request; not native or STEP bytes.
    const sha256=createHash('sha256').update(JSON.stringify(request.plate)).digest('hex');
    return {kind:'experimental_report',requestId:request.requestId,
      featureId:request.featureId,revision:request.revision,
      backend:'OCCT-cxx-8.0.1',occtVersion:'8.0.1',
      exactAuthority:false,independentInteroperability:false,
      observed:{source:{valid:true}},artifact:{
        path:'/synthetic-not-step',sha256,verification:'occt8_part21_plate_subset'},
      part21Audit:{kind:'part21-plate-structural-v1',sha256}};
  };
}
function evaluator(source,calls){
  const flow=createExperimentalPlateWorkflow({runtime,model,plateContract,
    providerKind:'occt8',runExperimentalPlate:syntheticPinnedProvider(calls)});
  return (id)=>flow.evaluate(source.history,{cutFeatureId:'cut',requestId:id,
    exportStep:true,readCurrentHistory:()=>source.history});
}

test('from-empty selected contour and circular cut compile to two distinct source-fenced pinned requests across edit, undo, redo and archive reopen',async()=>{
  const source=live();
  const blank=source.session.save();
  assert.equal(currentSketch(source.history).lines.length,0);
  assert.equal(currentSketch(source.history).circles.length,0);
  assert.equal(source.history.undoStack.length,0);
  const first=contour(source,'create');
  assert.equal(currentSketch(source.history).lines.length,4);
  assert.equal(source.history.undoStack.length,1);
  addBore(source);
  addSolidAndCut(source);
  const calls=[],evaluate=evaluator(source,calls);
  const one=await evaluate('drawn.native.first');
  assert.equal(one.kind,'experimental_plate_evaluated',JSON.stringify(one));
  assert.deepEqual(one.intendedPlate,{width:120,depth:80,thickness:8,
    holes:[{x:-25,y:0,radius:6}]});
  assert.equal(one.exactAuthority,false);
  assert.equal(one.independentInteroperability,false);
  assert.equal(source.session.currentStep(),null);
  const selected=first.contourReceipt.selection;
  const edited=contour(source,'edit',{selection:selected,
    changes:[{index:1,xMm:150,yMm:0},{index:2,xMm:150,yMm:80}]});
  assert.deepEqual(edited.invalidation.invalidatedFeatureIds,
    ['sketch.plate','plate','cut']);
  assert.equal(currentSketch(source.history).circles.length,1);
  assert.equal(source.session.refresh().stepAvailability,'unavailable');
  const two=await evaluate('drawn.native.second');
  assert.equal(two.kind,'experimental_plate_evaluated',JSON.stringify(two));
  assert.deepEqual(two.intendedPlate,{width:150,depth:80,thickness:8,
    holes:[{x:-40,y:0,radius:6}]});
  assert.notEqual(two.artifact.sha256,one.artifact.sha256);
  assert.notEqual(two.revision,one.revision);
  assert.equal(calls.length,2);
  const afterEdit=source.session.save();
  const reopened=runtime.reopen(afterEdit);
  assert.equal(runtime.save(reopened),afterEdit);
  const prior=send(source.session,'model.undo',{eventIds:['undo.drawn.resize']});
  assert.equal(prior.kind,'committed');
  assert.equal(runtime.inspect(source.history).features.find(f=>f.featureId==='plate')
    .profile.outer.reduce((max,p)=>Math.max(max,p.x),0),120);
  assert.equal(source.session.currentStep(),null);
  const resumed=send(source.session,'model.redo',{eventIds:['redo.drawn.resize']});
  assert.equal(resumed.kind,'committed');
  assert.equal(runtime.inspect(source.history).features.find(f=>f.featureId==='plate')
    .profile.outer.reduce((max,p)=>Math.max(max,p.x),0),150);
  assert.equal(source.session.currentStep(),null);
  assert.equal(runtime.save(runtime.reopen(source.session.save())),source.session.save());
  assert.notEqual(source.session.save(),blank);
  source.session.cancel();
});

test('from-empty contour refuses crossing and forged successor without publication; extra body blocks partial STEP before dispatch',async()=>{
  const source=live(),emptyArchive=source.session.save();
  const crossingDoc=currentSketch(source.history),signature=sketch.serializeSketch(crossingDoc);
  const crossingCommand={kind:'create-closed-contour',version:1,
    sourceSignature:signature,contourId:'crossing',
    vertices:[{x:0,y:0},{x:120,y:80},{x:0,y:80},{x:120,y:0}]};
  const crossing=createClosedContour(crossingDoc,crossingCommand);
  assert.equal(crossing.kind,'refused');
  const wrong=send(source.session,'sketch.contour/v1',{request:{
    format:CLOSED_CONTOUR_TRANSACTION_FORMAT,version:1,
    expectedArchive:emptyArchive,expectedSketchSignature:signature,
    sketchFeatureId:'sketch.plate',eventId:'crossing.refused',
    operation:'create',command:crossingCommand,acceptance:crossing}});
  assert.equal(wrong.kind,'refused');
  assert.equal(wrong.code,'sketch_refused');
  assert.equal(source.session.save(),emptyArchive);
  const created=contour(source,'create');
  const prior=source.session.save(),stamp=sketch.serializeSketch(currentSketch(source.history));
  const bogusSelection={...created.contourReceipt.selection,
    sourceSignature:stamp,candidateId:'forged.profile'};
  const bogusCommand={kind:'edit-closed-contour-vertices',version:1,
    sourceSignature:stamp,contourId:'user.rectangle',
    changes:[{index:1,xMm:150,yMm:0}]};
  const incorrect=send(source.session,'sketch.contour/v1',{request:{
    format:CLOSED_CONTOUR_TRANSACTION_FORMAT,version:1,
    expectedArchive:prior,expectedSketchSignature:stamp,
    sketchFeatureId:'sketch.plate',eventId:'bogus.selection',
    operation:'edit',command:bogusCommand,selection:bogusSelection,
    acceptance:created.contourReceipt}});
  assert.equal(incorrect.kind,'refused');
  assert.equal(source.session.save(),prior);
  addBore(source);
  addSolidAndCut(source);
  const added=send(source.session,'model.events',{events:[
    event('body.second.create',{id:'second.body',kind:'extrude',
      dependsOn:['sketch.plate'],writeTargets:['body.other'],
      payload:{sourceSketchId:'sketch.plate',thicknessMm:4}}),
  ]});
  assert.equal(added.kind,'committed');
  const calls=[],evaluate=evaluator(source,calls);
  const refused=await evaluate('drawn.native.omitted');
  assert.equal(refused.code,'unsupported_feature');
  assert.deepEqual(refused.unsupportedFeatureIds,['second.body']);
  assert.equal(calls.length,0);
  assert.equal(source.session.currentStep(),null);
  source.session.cancel();
});
