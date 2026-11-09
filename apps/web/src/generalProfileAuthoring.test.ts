import test from 'node:test';
import assert from 'node:assert/strict';
import * as sketch from '@intuit3d/sketch';
import {createClosedContour} from '@intuit3d/sketch/closed-contour-authoring/v1';
import {
  newModelEmptySketchSession,modelCurrentSketch,serializeModelSession,
  reopenModelSession,runtime,undoModelSession,redoModelSession,
} from './runtimeSession.ts';
import {
  selectedGeneralProfile,generalProfileBodies,authorGeneralProfileExtrusion,
  authorGeneralProfileCut,redimensionGeneralProfileExtrusion,
} from './generalProfileAuthoring.ts';

/** The same SKETCH + RUNTIME structural creation protocol used by actual
 * pointer Close, without a seeded fixture or a browser-owned sketch solver. */
function fromEmpty(points:readonly {x:number;y:number}[],projectId='general.user.drawn') {
  const base=newModelEmptySketchSession(projectId);
  const source=modelCurrentSketch(base);
  const command={
    kind:'create-closed-contour' as const,version:1 as const,
    sourceSignature:sketch.serializeSketch(source),contourId:'drawn.0',
    vertices:points.map(point=>({x:point.x,y:point.y})),
  };
  const acceptance=createClosedContour(source,command);
  assert.equal(acceptance.kind,'accepted');
  if(acceptance.kind!=='accepted')throw Error('SKETCH did not admit source');
  const result=runtime.commitClosedContour(base,{
    format:'intuit3d.runtime.closed-contour-transaction',version:1,
    expectedProjectId:base.document.projectId,
    expectedRevision:base.document.revision,
    expectedArchive:serializeModelSession(base),
    expectedSketchSignature:command.sourceSignature,
    sketchFeatureId:'sketch.plate',eventId:'general.test.close.0',
    operation:'create',admission:'require_admissible',command,acceptance,
  });
  assert.equal(result.kind,'committed');
  if(result.kind!=='committed')throw Error('RUNTIME did not accept structurally authored contour');
  return {history:result.history,selection:result.selection};
}

test('from-empty source-selected named extrusion and explicitly targeted cut survive undo/reopen/edit',()=>{
  const drawn=fromEmpty([{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}]);
  const originalArchive=serializeModelSession(drawn.history);
  const candidate=selectedGeneralProfile(drawn.history,drawn.selection,originalArchive);
  assert.match(candidate,/^cycle:/);
  assert.throws(()=>authorGeneralProfileExtrusion(drawn.history,drawn.selection,
    originalArchive,'extrude.part','body.part',0),/positive/);
  const extruded=authorGeneralProfileExtrusion(drawn.history,drawn.selection,
    originalArchive,'extrude.part','body.part',8);
  assert.equal(extruded.status,'preview_only');
  assert.equal(extruded.nativeHandoff,null);
  assert.equal(generalProfileBodies(extruded.history)[0].bodyId,'body.part');
  assert.throws(()=>authorGeneralProfileExtrusion(extruded.history,drawn.selection,
    serializeModelSession(extruded.history),'extrude.part','body.other',8),/identity already exists/);
  const afterExtrusion=serializeModelSession(extruded.history);
  assert.throws(()=>authorGeneralProfileCut(extruded.history,drawn.selection,
    afterExtrusion,'extrude.part','body.missing','cut.part'),/target body/);
  const cut=authorGeneralProfileCut(extruded.history,drawn.selection,
    afterExtrusion,'extrude.part','body.part','cut.part');
  assert.equal(cut.status,'pending_exact_provider');
  assert.equal(cut.nativeHandoff.compatibility,'not_claimed_ask_RUNTIME_provider');
  assert.equal(runtime.inspect(cut.history).features.find(f=>f.featureId==='cut.part')?.status,
    'pending_exact_provider');
  const reopened=reopenModelSession(serializeModelSession(cut.history));
  assert.equal(generalProfileBodies(reopened).length,1);
  assert.equal(generalProfileBodies(reopened)[0].depthMm,8);
  assert.equal(selectedGeneralProfile(reopened,drawn.selection,serializeModelSession(reopened)),
    candidate,'same source-owned SKETCH cycle after Worker-equivalent RUNTIME reopen');
  const changed=redimensionGeneralProfileExtrusion(reopened,drawn.selection,
    serializeModelSession(reopened),'extrude.part','body.part',14);
  assert.equal(changed.status,'preview_only');
  assert.equal(changed.history.document.revision>reopened.document.revision,true);
  assert.ok(changed.invalidation.invalidatedFeatureIds.includes('cut.part'));
  assert.equal(generalProfileBodies(changed.history)[0].depthMm,14);
  const undid=undoModelSession(changed.history);
  assert.equal(generalProfileBodies(undid)[0].depthMm,8);
  const redid=redoModelSession(undid);
  assert.equal(generalProfileBodies(redid)[0].depthMm,14);
  assert.equal(runtime.inspect(reopenModelSession(serializeModelSession(redid)))
    .features.find(f=>f.featureId==='cut.part')?.status,'pending_exact_provider');
});

test('the selected source is full-archive fenced, not merely project/revision or a screenshot',()=>{
  const first=fromEmpty([{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}],
    'general.equal.revision');
  const second=fromEmpty([{x:0,y:0},{x:150,y:0},{x:150,y:80},{x:0,y:80}],
    'general.equal.revision');
  assert.equal(first.history.document.revision,second.history.document.revision);
  assert.notEqual(serializeModelSession(first.history),serializeModelSession(second.history));
  assert.throws(()=>selectedGeneralProfile(second.history,first.selection,
    serializeModelSession(first.history)),/stale canonical archive/);
  assert.throws(()=>selectedGeneralProfile(second.history,first.selection,
    serializeModelSession(second.history)),/stale SKETCH signature/);
  assert.throws(()=>authorGeneralProfileExtrusion(second.history,first.selection,
    serializeModelSession(second.history),'extrude.part','body.part',8),/stale SKETCH/);
});
