import test from 'node:test';
import assert from 'node:assert/strict';
import {createLivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';
import * as sketch from '@intuit3d/sketch';
import {
  newModelEmptySketchSession,modelCurrentSketch,reopenModelSession,
  serializeModelSession,undoModelSession,redoModelSession,runtime,
} from './runtimeSession.ts';
import {startModelBlankContour,commitModelBlankContour} from './closedContourBridge.ts';
import {appendBlankContourPoint} from './blankContourDraft.ts';
import {inspectModelContourEdges,offsetModelClosedContourEdge,
  dragModelClosedContourEdge} from './closedContourEdgeBridge.ts';

function fixture(project='workbench.edge.direct') {
  let history=newModelEmptySketchSession(project);
  const session=createLivePlateSession({runtime,readCurrentHistory:()=>history,
    publishHistory:next=>{history=next;}});
  let draft=startModelBlankContour(history);
  for(const p of [{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}]) {
    const next=appendBlankContourPoint(draft,p);
    assert.equal(next.kind,'added');
    if(next.kind!=='added')throw Error('invalid fixture');
    draft=next.draft;
  }
  const closed=commitModelBlankContour(history,session,draft);
  assert.equal(closed.kind,'committed',JSON.stringify(closed));
  if(closed.kind!=='committed')throw Error('No admitted rectangle');
  return {get history(){return history;},session,selection:closed.selection};
}
const coordinates=(h:ReturnType<typeof newModelEmptySketchSession>)=>
  modelCurrentSketch(h).points.map(p=>({id:p.id,x:p.x,y:p.y}));

test('selected actual right edge moves both endpoints through one RUNTIME event and durable archive',()=>{
  const f=fixture();
  const original=f.history,signature=sketch.serializeSketch(modelCurrentSketch(original));
  const inventory=inspectModelContourEdges(original,f.selection);
  assert.equal(inventory?.kind,'contour_edges');
  assert.equal(inventory?.edges.length,4);
  const edge=inventory!.edges.find(e=>Math.abs(e.start.x-120)<1e-6&&Math.abs(e.end.x-120)<1e-6);
  assert.ok(edge,'must select actual source-owned right boundary, not display edge');
  const archive=serializeModelSession(original);
  const moved=dragModelClosedContourEdge(original,f.session,f.selection,edge!.edgeId,
    edge!.midpoint,{x:edge!.midpoint.x+20,y:edge!.midpoint.y+15},archive);
  assert.equal(moved.kind,'committed',JSON.stringify(moved));
  if(moved.kind!=='committed')return;
  assert.ok(Math.abs(moved.appliedOffsetMm-20)<1e-6);
  assert.equal(f.history.document.revision,original.document.revision+1);
  const after=inspectModelContourEdges(f.history,moved.selection);
  assert.ok(after);
  const successor=after!.edges.find(e=>e.edgeId===edge!.edgeId);
  assert.ok(successor);
  assert.ok(Math.abs(successor!.start.x-140)<1e-6);
  assert.ok(Math.abs(successor!.end.x-140)<1e-6);
  assert.equal(successor!.midpoint.y,40,'tangential motion cannot translate the edge');
  assert.equal(sketch.serializeSketch(modelCurrentSketch(original)),signature,'source is unchanged');
  assert.equal(moved.selection.sourceSignature,sketch.serializeSketch(modelCurrentSketch(f.history)));
  const opened=reopenModelSession(serializeModelSession(f.history));
  const undone=undoModelSession(opened);
  assert.equal(sketch.serializeSketch(modelCurrentSketch(undone)),signature);
  const redone=redoModelSession(undone);
  assert.equal(sketch.serializeSketch(modelCurrentSketch(redone)),moved.selection.sourceSignature);
  assert.equal(inspectModelContourEdges(redone,moved.selection)?.edges.length,4);
});

test('numeric inward edge offset, stale archive, forged edges and collapse are refusals without loss',()=>{
  const f=fixture('workbench.edge.refusal');
  const h=f.history, archive=serializeModelSession(h);
  const edges=inspectModelContourEdges(h,f.selection)!.edges;
  const right=edges.find(e=>Math.abs(e.midpoint.x-120)<1e-6)!;
  assert.equal(offsetModelClosedContourEdge(h,f.session,f.selection,right.edgeId,-150,archive).kind,'refused');
  assert.equal(offsetModelClosedContourEdge(h,f.session,f.selection,'fabricated.edge',10,archive).kind,'refused');
  assert.equal(offsetModelClosedContourEdge(h,f.session,f.selection,right.edgeId,Infinity,archive).kind,'refused');
  assert.equal(dragModelClosedContourEdge(h,f.session,f.selection,right.edgeId,
    {x:120,y:40},{x:Infinity,y:42},archive).kind,'refused');
  assert.equal(serializeModelSession(f.history),archive);
  const accepted=offsetModelClosedContourEdge(h,f.session,f.selection,right.edgeId,10,archive);
  assert.equal(accepted.kind,'committed',JSON.stringify(accepted));
  assert.equal(offsetModelClosedContourEdge(f.history,f.session,f.selection,
    right.edgeId,10,archive).kind,'refused','old canonical archive rejected after change');
  assert.equal(dragModelClosedContourEdge(f.history,f.session,f.selection,
    right.edgeId,{x:120,y:40},{x:130,y:40},archive).kind,'refused');
  assert.equal(inspectModelContourEdges(f.history,f.selection),null,
    'source-signature stale selection never gains new geometry authority');
});
