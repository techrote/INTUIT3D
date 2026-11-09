import test from 'node:test';
import assert from 'node:assert/strict';
import * as sketch from '@intuit3d/sketch';
import {createLivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';
import {newModelEmptySketchSession,modelCurrentSketch,
  serializeModelSession,reopenModelSession,undoModelSession,redoModelSession,runtime}
  from './runtimeSession.ts';
import {startModelBlankContour,commitModelBlankContour} from './closedContourBridge.ts';
import {inspectModelContourEdges} from './closedContourEdgeBridge.ts';
import {appendBlankContourPoint} from './blankContourDraft.ts';
import {insertModelContourTab,editModelTabbedVertex,inspectModelTabbedContour,previewModelContourTab}
  from './tabbedContourBridge.ts';

function fixture(project='workbench.tab.pointer') {
  let current=newModelEmptySketchSession(project);
  const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
    publishHistory:next=>{current=next;}});
  let draft=startModelBlankContour(current);
  for(const point of [{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}]){
    const step=appendBlankContourPoint(draft,point);
    assert.equal(step.kind,'added');
    if(step.kind!=='added')throw Error('Blank fixture rejected');
    draft=step.draft;
  }
  const created=commitModelBlankContour(current,session,draft);
  assert.equal(created.kind,'committed',JSON.stringify(created));
  if(created.kind!=='committed')throw Error('Closure rejected');
  const right=inspectModelContourEdges(current,created.selection)!.edges.find(
    e=>e.start.x===120&&e.end.x===120);
  assert.ok(right);
  return {get current(){return current;},session,selection:created.selection,
    edgeId:right!.edgeId};
}
test('source-owned two-pointer tab is atomic, stable, dimensionable, undoable and reopens',()=>{
  const f=fixture(),prior=f.current,source=serializeModelSession(prior);
  const originalIds=modelCurrentSketch(prior).points.map(p=>p.id);
  const result=insertModelContourTab(prior,f.session,f.selection,f.edgeId,
    [{x:140,y:20},{x:140,y:60}],source);
  assert.equal(result.kind,'committed',JSON.stringify(result));
  if(result.kind!=='committed')return;
  assert.equal(f.current.document.revision,prior.document.revision+1);
  assert.ok(result.retiredEdgeIds.includes(f.edgeId));
  assert.equal(modelCurrentSketch(f.current).lines.length,6);
  for(const id of originalIds)assert.ok(modelCurrentSketch(f.current).points.some(p=>p.id===id));
  assert.ok(!modelCurrentSketch(f.current).lines.some(l=>l.id===f.edgeId));
  const inspected=inspectModelTabbedContour(f.current,result.selection);
  assert.equal(inspected?.kind,'tabbed_closed_contour');
  assert.equal(inspected?.handles.length,6);
  assert.equal(inspected?.handles.filter(h=>h.kind==='inserted').length,2);
  const chosen=inspected!.handles.find(h=>h.kind==='inserted')!;
  const edited=editModelTabbedVertex(f.current,f.session,result.selection,chosen.handleId,
    {x:145,y:20},serializeModelSession(f.current));
  assert.equal(edited.kind,'committed',JSON.stringify(edited));
  if(edited.kind!=='committed')return;
  const restored=reopenModelSession(serializeModelSession(f.current));
  assert.equal(inspectModelTabbedContour(restored,edited.selection)?.handles.find(
    h=>h.handleId===chosen.handleId)?.position.x,145);
  const back=undoModelSession(restored);
  assert.equal(inspectModelTabbedContour(back,result.selection)?.handles.find(
    h=>h.handleId===chosen.handleId)?.position.x,140);
  const redone=redoModelSession(back);
  assert.equal(sketch.serializeSketch(modelCurrentSketch(redone)),edited.selection.sourceSignature);
  assert.equal(inspectModelTabbedContour(redone,edited.selection)?.handles.find(
    h=>h.handleId===chosen.handleId)?.position.x,145);
  const previous=undoModelSession(back);
  assert.equal(modelCurrentSketch(previous).lines.length,4);
  assert.equal(serializeModelSession(reopenModelSession(source)),source);
});
test('stale canonical archive, wrong edge and crossing insertion refuse without journal mutation',()=>{
  const f=fixture('workbench.tab.negative');
  const before=serializeModelSession(f.current);
  const points:[{x:number;y:number},{x:number;y:number}]=[{x:140,y:20},{x:140,y:60}];
  assert.equal(insertModelContourTab(f.current,f.session,f.selection,'madeup',points,before).kind,'refused');
  assert.equal(insertModelContourTab(f.current,f.session,f.selection,f.edgeId,
    [{x:60,y:95},{x:60,y:-20}],before).kind,'refused');
  assert.equal(insertModelContourTab(f.current,f.session,f.selection,f.edgeId,points,before+' ' ).kind,'refused');
  assert.equal(insertModelContourTab(f.current,f.session,f.selection,f.edgeId,
    [{x:Infinity,y:20},{x:140,y:60}],before).kind,'refused');
  assert.equal(serializeModelSession(f.current),before);
  const good=insertModelContourTab(f.current,f.session,f.selection,f.edgeId,points,before);
  assert.equal(good.kind,'committed',JSON.stringify(good));
  assert.equal(insertModelContourTab(f.current,f.session,f.selection,f.edgeId,points,before).kind,'refused');
  if(good.kind!=='committed')return;
  assert.equal(editModelTabbedVertex(f.current,f.session,f.selection,
    'forged.handle',{x:145,y:20},serializeModelSession(f.current)).kind,'refused');
  assert.equal(editModelTabbedVertex(f.current,f.session,good.selection,
    'forged.handle',{x:145,y:20},serializeModelSession(f.current)).kind,'refused');
});

test('precommit preview is SKETCH-owned, rejects crossings, and never journals an event',()=>{
  const f=fixture('workbench.tab.preflight'),source=serializeModelSession(f.current);
  const originalRevision=f.current.document.revision;
  const good=previewModelContourTab(f.current,f.selection,f.edgeId,
    [{x:140,y:20},{x:140,y:60}],source);
  assert.equal(good.kind,'admissible',JSON.stringify(good));
  if(good.kind==='admissible') {
    assert.equal(good.retiredEdgeId,f.edgeId);
    assert.notEqual(good.nextSketchSignature,f.selection.sourceSignature);
  }
  const crossing=previewModelContourTab(f.current,f.selection,f.edgeId,
    [{x:60,y:95},{x:60,y:-20}],source);
  assert.equal(crossing.kind,'refused',JSON.stringify(crossing));
  const wrongEdge=previewModelContourTab(f.current,f.selection,'wrong:edge',
    [{x:140,y:20},{x:140,y:60}],source);
  assert.equal(wrongEdge.kind,'refused');
  const stale=previewModelContourTab(f.current,f.selection,f.edgeId,
    [{x:140,y:20},{x:140,y:60}],source+' ');
  assert.equal(stale.kind,'refused');
  assert.equal(f.current.document.revision,originalRevision);
  assert.equal(serializeModelSession(f.current),source);
  // Preview is not permission to commit a different source. RUNTIME still
  // rechecks the full canonical archive and source-selected semantic edge.
  const committed=insertModelContourTab(f.current,f.session,f.selection,f.edgeId,
    [{x:140,y:20},{x:140,y:60}],source);
  assert.equal(committed.kind,'committed',JSON.stringify(committed));
  assert.equal(previewModelContourTab(f.current,f.selection,f.edgeId,
    [{x:140,y:20},{x:140,y:60}],source).kind,'refused');
});
