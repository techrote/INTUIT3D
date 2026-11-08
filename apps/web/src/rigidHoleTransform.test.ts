import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modelHoleValues,newModelSketchSession,undoModelSession,redoModelSession,
  serializeModelSession,reopenModelSession,inspectModelSession,previewModelSketchProfile,
} from './runtimeSession.ts';
import {transformSelectedModelHoles} from './rigidHoleTransform.ts';

test('rigid rotation uses authoritative holes, retains radii/IDs and one undo frame',()=>{
  const source=newModelSketchSession('workbench.rigid.rotation');
  const before=modelHoleValues(source);
  const ids=['holeA','holeB'];
  const pivotX=(before.holeA.x+before.holeB.x)/2;
  const pivotY=(before.holeA.y+before.holeB.y)/2;
  const result=transformSelectedModelHoles(source,{
    holeIds:ids,rotateDegrees:90,translateXmm:0,translateYmm:0,
  });
  assert.equal(result.kind,'committed');
  if(result.kind!=='committed')return;
  const next=result.history;
  assert.equal(next.document.revision,source.document.revision+1);
  assert.equal(next.undoStack.length,source.undoStack.length+1);
  assert.equal(previewModelSketchProfile(inspectModelSession(next))?.holes.length,2);
  const after=modelHoleValues(next);
  for(const id of ids){
    assert.ok(Math.abs(after[id].x-(pivotX-(before[id].y-pivotY)))<1e-6,id+' X');
    assert.ok(Math.abs(after[id].y-(pivotY+(before[id].x-pivotX)))<1e-6,id+' Y');
    assert.equal(after[id].diameter,before[id].diameter,id+' bore');
  }
  const reopened=reopenModelSession(serializeModelSession(next));
  assert.deepEqual(modelHoleValues(reopened),after,'archive persists identities and rotation');
  const undone=undoModelSession(reopened);
  assert.deepEqual(modelHoleValues(undone),before,'Undo atomically restores both');
  const redone=redoModelSession(undone);
  assert.deepEqual(modelHoleValues(redone),after,'Redo restores both IDs');
});

test('invalid and physically inadmissible transforms preserve the entire source archive',()=>{
  const source=newModelSketchSession('workbench.rigid.refusal');
  const saved=serializeModelSession(source);
  const good={holeIds:['holeA','holeB'],translateXmm:0,translateYmm:0,rotateDegrees:90};
  assert.throws(()=>transformSelectedModelHoles(source,{...good,holeIds:['holeA','holeA']}),/distinct/);
  assert.throws(()=>transformSelectedModelHoles(source,{...good,holeIds:['holeA','missing']}),/Unknown authored/);
  assert.throws(()=>transformSelectedModelHoles(source,{...good,rotateDegrees:360}),/rotation below/);
  assert.throws(()=>transformSelectedModelHoles(source,{...good,rotateDegrees:0}),/nonzero/);
  assert.throws(()=>transformSelectedModelHoles(source,{...good,translateXmm:Infinity}),/finite/);
  try {
    const bad=transformSelectedModelHoles(source,{...good,rotateDegrees:0,translateXmm:300});
    assert.equal(bad.kind,'refused','out-of-plate transform must refuse');
  }catch(error){
    assert.match(String(error),/profile|admiss|outside|invalid/i);
  }
  assert.equal(serializeModelSession(source),saved,'failed proposals never modify authoritative state');
});
