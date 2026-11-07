import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '@intuit3d/model';
import * as sketch from '@intuit3d/sketch';
import {parsePlateRequest,expectedPlateMetrics} from '@intuit3d/kernel-contract/plate-v1';
import {
  runtime,newPlateHistory,editPlateThickness,plateRequestFromHistory,
} from '../model-native-plate.mjs';

const feature=(history,id)=>model.featuresOf(history.document).find(f=>f.id===id);

test('real INTENT/SKETCH/RUNTIME v1 → typed KERNEL request with authored cut',()=>{
  const history=newPlateHistory();
  const {request,report}=plateRequestFromHistory(history);
  assert.deepEqual(parsePlateRequest(request),request);
  assert.equal(report.exactGeometryAvailable,false);
  assert.deepEqual(report.authoredOrder,['sketch.plate','plate','cut','parameter.t']);
  assert.ok(report.executableOrder.indexOf('parameter.t')<report.executableOrder.indexOf('plate'));
  assert.equal(report.features.find(f=>f.featureId==='cut').status,'pending_exact_provider');
  assert.equal(report.features.find(f=>f.featureId==='plate').status,'preview_only');
  assert.equal(request.featureId,'plate');
  assert.equal(request.exportStep,true);
  assert.equal(request.plate.width,120);
  assert.equal(request.plate.depth,80);
  assert.equal(request.plate.thickness,8);
  assert.deepEqual(request.plate.holes,[
    {x:-25,y:0,radius:6},{x:25,y:0,radius:6},
  ]);
  assert.ok(Math.abs(expectedPlateMetrics(request.plate).volumeMm3-74990.44263153228)<1e-7);
});

test('retrospective 8→12 mm edit invalidates dependent cut; archive/reopen and undo are authoritative',()=>{
  const before=newPlateHistory(),serialized=runtime.save(before);
  const restored=runtime.reopen(serialized);
  assert.equal(runtime.save(restored),serialized);
  const after=editPlateThickness(restored,12);
  const a=plateRequestFromHistory(before).request;
  const b=plateRequestFromHistory(after).request;
  assert.equal(feature(before,'plate').payload.thicknessMm,8,'no destructive authored edit');
  assert.equal(feature(after,'plate').payload.thicknessMm,8);
  assert.equal(a.plate.thickness,8);
  assert.equal(b.plate.thickness,12);
  assert.equal(b.revision,a.revision+1);
  assert.equal(b.requestId,'integration.plate.'+b.revision);
  const delta=runtime.diff(restored,after);
  assert.deepEqual(delta.changedFeatureIds,['parameter.t']);
  assert.deepEqual(delta.invalidatedFeatureIds,['plate','cut','parameter.t']);
  assert.ok(delta.unchangedFeatureIds.includes('sketch.plate'));
  assert.equal(delta.exactReuseAllowed,false);
  assert.equal(plateRequestFromHistory(runtime.reopen(runtime.save(after))).request.plate.thickness,12);
  const undone=runtime.undo(after,['undo.thickness']);
  assert.equal(plateRequestFromHistory(undone).request.plate.thickness,8);
});

test('unresolved sketch is not converted to native geometry or an old successful request',()=>{
  const before=newPlateHistory();
  const original=feature(before,'sketch.plate');
  const broken=sketch.editConstraint(original.payload.sketch,'width',{value:40});
  const after=runtime.commit(before,[{
    eventId:'edit.rejected.width',type:'feature.edit',featureId:'sketch.plate',
    patch:{payload:{...original.payload,sketch:broken}},
  }]);
  assert.throws(()=>plateRequestFromHistory(after),/no current admitted plate preview/);
  assert.equal(plateRequestFromHistory(before).request.plate.width,120);
  assert.equal(feature(after,'sketch.plate').payload.sketch.constraints.find(c=>c.id==='width').value,40);
});

test('reject non-centred STEP frame and unmatched semantic cut targets',()=>{
  const original=newPlateHistory();
  const source=feature(original,'sketch.plate');
  const translated=structuredClone(source.payload.sketch);
  translated.points=translated.points.map(p=>({...p,x:p.x+1}));
  translated.constraints=translated.constraints.map(c=>c.kind==='fixed'
    ? {...c,x:c.x+1}:c);
  const moved=runtime.commit(original,[{
    eventId:'edit.placement',type:'feature.edit',featureId:'sketch.plate',
    patch:{payload:{...source.payload,sketch:translated}},
  }]);
  assert.throws(()=>plateRequestFromHistory(moved),/centred axis-aligned rectangle/);
  const wrong=runtime.commit(original,[{
    eventId:'edit.cut-target',type:'feature.edit',featureId:'cut',
    patch:{payload:{sourceSketchId:'sketch.plate',targetBodyId:'body.unrelated'}},
  }]);
  assert.throws(()=>plateRequestFromHistory(wrong),/cut semantic target\/source mismatch/);
});
