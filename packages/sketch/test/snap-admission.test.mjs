import test from 'node:test';
import assert from 'node:assert/strict';
import {createSketch,plateSketchFixture,editConstraint,solveSketch,serializeSketch,parseSketch} from '../index.mjs';
import {suggestSketchSnaps} from '../snap.mjs';
import {SNAP_ADMISSION_VERSION,proposeSnapConstraint,commitSnapConstraint} from '../snap-admission.mjs';

const free=()=>createSketch({version:1,units:'mm',
  points:[{id:'moving',x:9,y:9},{id:'anchor',x:0,y:0}],
  lines:[],circles:[],constraints:[{id:'lock',kind:'fixed',point:'anchor',x:0,y:0}]});
const command=(doc,pointId,cursor,opts={},id='snapConstraint')=>({
  pointId,constraintId:id,options:opts,snap:suggestSketchSnaps(doc,cursor,opts)
});

test('point snap becomes an admitted coincidence and commits without losing authored IDs',()=>{
  const doc=free(),old=serializeSketch(doc);
  const request=command(doc,'moving',{x:0,y:0},{excludeIds:['moving']});
  assert.equal(request.snap.selected.id,'point:anchor');
  const preview=proposeSnapConstraint(doc,request);
  assert.equal(preview.version,SNAP_ADMISSION_VERSION);
  assert.equal(preview.previewOnly,true);
  assert.equal(preview.sourceStatus,'underconstrained');
  assert.equal(preview.status,'admissible');
  assert.equal(preview.resultStatus,'solved');
  assert.deepEqual(preview.suggestedConstraint,
    {id:'snapConstraint',kind:'coincident',a:'moving',b:'anchor'});
  assert.deepEqual(preview.movedPoints,[{id:'moving',from:{x:9,y:9},to:{x:0,y:0}}]);
  assert.equal(serializeSketch(doc),old);
  const committed=commitSnapConstraint(doc,preview);
  assert.equal(committed.constraints.at(-1).id,'snapConstraint');
  assert.equal(solveSketch(committed).status,'solved');
  assert.equal(serializeSketch(parseSketch(serializeSketch(committed))),serializeSketch(committed));
});

test('grid inference becomes an explicit dimensioned fixed constraint',()=>{
  const doc=createSketch({version:1,units:'mm',points:[{id:'free',x:2.4,y:3.6}],
    lines:[],circles:[],constraints:[]});
  const request=command(doc,'free',{x:2.4,y:3.6},{gridMm:1,excludeIds:['free']});
  assert.equal(request.snap.selected.kind,'grid');
  const proposal=proposeSnapConstraint(doc,request);
  assert.equal(proposal.status,'admissible');
  assert.deepEqual(proposal.suggestedConstraint,
    {id:'snapConstraint',kind:'fixed',point:'free',x:2,y:4});
  assert.equal(solveSketch(commitSnapConstraint(doc,proposal)).degreesOfFreedom,0);
});

test('incompatible coincidence is reported and cannot be silently committed',()=>{
  const doc=plateSketchFixture(),before=serializeSketch(doc);
  const proposal=proposeSnapConstraint(doc,command(doc,'p1',{x:0,y:0},{excludeIds:['p1']}));
  assert.equal(proposal.status,'conflicted');
  assert.equal(proposal.previewGeometry,null);
  assert.equal(proposal.suggestedConstraint.kind,'coincident');
  assert.ok(proposal.diagnostics.some(d=>d.code==='contradictory_constraints'));
  assert.throws(()=>commitSnapConstraint(doc,proposal),/stale, rejected/);
  assert.equal(serializeSketch(doc),before);
});

test('midpoint, perimeter, quadrant and segment snaps are not replaced by unconstrained fixes',()=>{
  const doc=plateSketchFixture();
  for(const [cursor,kind] of [
    [{x:60,y:0},'midpoint'],[{x:39.95,y:44.95},'circle_perimeter'],
    [{x:41,y:40},'circle_quadrant'],[{x:30,y:0.5},'segment']
  ]){
    const opts={radiusMm:2,excludeIds:['p2']};
    const cmd=command(doc,'p2',cursor,opts);
    assert.equal(cmd.snap.selected.kind,kind,JSON.stringify(cursor));
    const proposal=proposeSnapConstraint(doc,cmd);
    assert.equal(proposal.status,'unsupported_kind');
    assert.equal(proposal.suggestedConstraint,null);
    assert.equal(proposal.previewGeometry,null);
  }
});

test('changed width invalidates snap and proposal, preserving original state',()=>{
  const doc=plateSketchFixture();
  const cmd=command(doc,'p3',{x:120,y:0},{excludeIds:['p3']});
  const preview=proposeSnapConstraint(doc,cmd);
  const updated=editConstraint(doc,'width',{value:140});
  assert.equal(proposeSnapConstraint(updated,cmd).status,'stale');
  assert.throws(()=>commitSnapConstraint(updated,preview),/stale, rejected/);
  assert.equal(solveSketch(updated).geometry.points.find(p=>p.id==='p1').x,140);
});

test('forged candidate position, identity, ranking or inference options are refused',()=>{
  const doc=free(),cmd=command(doc,'moving',{x:0,y:0},{excludeIds:['moving']});
  for(const mutate of [
    r=>{r.snap.selected.x=900;},
    r=>{r.snap.candidates[0].id='point:moving';},
    r=>{r.snap.cursor.x=100;},
    r=>{r.options.maxEntities=1;}
  ]){
    const forged=structuredClone(cmd);
    mutate(forged);
    assert.equal(proposeSnapConstraint(doc,forged).status,'invalid_selection');
  }
});

test('commit replays and rejects a modified equation, coordinates or preview status',()=>{
  const doc=free(),proposal=proposeSnapConstraint(doc,command(doc,'moving',{x:0,y:0},{excludeIds:['moving']}));
  for(const mutate of [
    p=>{p.suggestedConstraint.b='moving';},
    p=>{p.movedPoints=[];},
    p=>{p.previewGeometry.points[0].x=1000;},
    p=>{p.status='blocked';}
  ]){
    const forged=structuredClone(proposal);
    mutate(forged);
    assert.throws(()=>commitSnapConstraint(doc,forged),/stale, rejected/);
  }
  assert.equal(commitSnapConstraint(doc,proposal).constraints.length,2);
});

test('self-snaps and duplicate/invalid explicit IDs cannot enter the journal',()=>{
  const doc=free();
  const self=proposeSnapConstraint(doc,command(doc,'anchor',{x:0,y:0}));
  assert.equal(self.status,'unsupported_kind');
  assert.equal(self.reason,'self_reference');
  for(const id of ['lock','anchor','bad id','', 'x'.repeat(129)])
    assert.throws(()=>proposeSnapConstraint(doc,command(doc,'moving',{x:0,y:0},{excludeIds:['moving']},id)),
      /invalid or duplicate authored constraint ID/);
});

test('conflicted source, empty candidate, and entity budget return explicit refusals',()=>{
  const doc=plateSketchFixture();
  const conflicted=structuredClone(doc);
  conflicted.constraints.push({id:'impossible',kind:'distanceX',a:'p0',b:'p1',value:130});
  assert.equal(proposeSnapConstraint(conflicted,command(conflicted,'p2',{x:0,y:0})).status,'source_unsolved');
  assert.equal(proposeSnapConstraint(doc,command(doc,'p2',{x:1000,y:1000})).status,'snap_unavailable');
  assert.equal(proposeSnapConstraint(doc,command(doc,'p2',{x:0,y:0},{maxEntities:1})).status,'snap_unavailable');
});

test('circle-center semantic target maps to the actual authored center point',()=>{
  const doc=plateSketchFixture();
  const request=command(doc,'p2',{x:35,y:40},{radiusMm:0.1,excludeIds:['holeA:center','p2']});
  assert.equal(request.snap.selected.kind,'circle_center');
  const preview=proposeSnapConstraint(doc,request);
  assert.equal(preview.status,'conflicted');
  assert.deepEqual(preview.suggestedConstraint,
    {id:'snapConstraint',kind:'coincident',a:'p2',b:'holeA:center'});
});

test('64 changed-dimension/grid roundtrips never alter original sketch or candidate IDs',()=>{
  for(const width of [80,100,120,140]){
    const doc=editConstraint(plateSketchFixture(),'width',{value:width});
    const before=serializeSketch(doc);
    for(let i=0;i<16;i++){
      const x=width*(i+0.25)/16;
      const cmd=command(doc,'p3',{x,y:0.2},{radiusMm:5,gridMm:5,excludeIds:['p3']});
      const preview=proposeSnapConstraint(doc,cmd);
      if(preview.status==='admissible'){
        const accepted=commitSnapConstraint(doc,preview);
        assert.ok(accepted.constraints.some(c=>c.id==='snapConstraint'));
      }else{
        assert.ok(['conflicted','unsupported_kind','snap_unavailable'].includes(preview.status));
      }
      assert.equal(serializeSketch(doc),before);
      assert.equal(preview.inputSignature,before);
    }
  }
});

test('large dense solves refuse before admission re-solving, with no source mutation',()=>{
  const doc=createSketch({version:1,units:'mm',
    points:Array.from({length:129},(_,i)=>({id:'p'+i,x:i,y:0})),
    lines:[],circles:[],constraints:[]});
  const signature=serializeSketch(doc);
  const request={pointId:'p0',constraintId:'newFix',
    snap:{version:1,previewOnly:true,inputSignature:signature,cursor:{x:0,y:0}}};
  const proposal=proposeSnapConstraint(doc,request);
  assert.equal(proposal.status,'budget_exceeded');
  assert.equal(proposal.reason,'dense_linear_system_limit');
  assert.equal(proposal.sourceStatus,null);
  assert.equal(proposal.degreesOfFreedomBefore,null);
  assert.equal(proposal.previewGeometry,null);
  assert.throws(()=>commitSnapConstraint(doc,proposal),/stale, rejected/);
  assert.equal(serializeSketch(doc),signature);
});
