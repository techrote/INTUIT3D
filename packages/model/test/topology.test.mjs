import assert from 'node:assert/strict';
import test from 'node:test';
import {TOPOLOGY_REFERENCE_FORMAT,parseSemanticTopologyReference,resolveSemanticTopologyReference,TopologyEvidenceError} from '../src/topology.ts';
const role=(featureId,roleId,kind='face')=>({featureId,roleId,kind});
const base=role('feature.plate','role.top'), alt=role('feature.cut','role.a'), alt2=role('feature.cut','role.b');
const ref=(anchor=base,atRevision=2,projectId='project.plate')=>({format:TOPOLOGY_REFERENCE_FORMAT,version:1,projectId,atRevision,anchor});
const snap=(observedRoles=[base],atRevision=2,projectId='project.plate')=>({projectId,atRevision,observedRoles});
const row=(from,to,confidence='observed')=>({from,to,confidence});
const step=(fromRevision,mappings,coverage='complete',projectId='project.plate')=>({projectId,fromRevision,toRevision:fromRevision+1,coverage,mappings});
const binding=(target,atRevision=3,source=base)=>({format:'intuit3d.semantic-topology-binding',version:1,projectId:'project.plate',atRevision,source,target});
const run=(steps=[],target=2,b)=>resolveSemanticTopologyReference(ref(),snap(),steps,target,b);
const codes=r=>r.diagnostics.map(d=>d.code);

test('versioned semantic JSON anchor round-trip preserves source IDs and role',()=>{
  assert.deepEqual(parseSemanticTopologyReference(JSON.parse(JSON.stringify(ref()))),ref());
});
test('observed original role resolves at same revision without fabricating B-rep',()=>{
  assert.equal(run().status,'resolved'); assert.deepEqual(run().candidates,[base]);
});
test('explicit one-to-one provenance follows role replacement',()=>{
  const r=run([step(2,[row([base],[alt])])],3);
  assert.equal(r.status,'resolved'); assert.deepEqual(r.candidates,[alt]);assert.equal(r.lastObservedRevision,3);
});
test('split enumerates candidates deterministically without picking first',()=>{
  const r=run([step(2,[row([base],[alt2,alt])])],3);
  assert.equal(r.status,'requires_reconciliation');assert.deepEqual(r.candidates,[alt,alt2]);assert.ok(codes(r).includes('SPLIT'));
});
test('merge with another source remains ambiguous even with one output',()=>{
  const r=run([step(2,[row([base,role('feature.plate','role.bottom')],[alt])])],3);
  assert.equal(r.status,'requires_reconciliation');assert.ok(codes(r).includes('MERGE'));
});
test('split then merge does not erase historical semantic ambiguity',()=>{
  const joined=role('feature.join','role.join');
  const r=run([step(2,[row([base],[alt,alt2])]),step(3,[row([alt,alt2],[joined])])],4);
  assert.equal(r.status,'requires_reconciliation');assert.deepEqual(r.candidates,[joined]);assert.deepEqual(codes(r),['SPLIT','MERGE','MERGE']);
});
test('explicit manual choice is revision-fenced, not presented as automatic identity',()=>{
  const steps=[step(2,[row([base],[alt2,alt])])];
  assert.equal(run(steps,3,binding(alt)).status,'resolved_manual');
  const stale=run(steps,3,binding(alt,4));
  assert.equal(stale.status,'requires_reconciliation');assert.ok(codes(stale).includes('INVALID_BINDING'));
});
test('manual binding cannot nominate absent or wrong-source target',()=>{
  const steps=[step(2,[row([base],[alt])])];
  assert.ok(codes(run(steps,3,binding(alt2))).includes('INVALID_BINDING'));
  assert.ok(codes(run(steps,3,binding(alt,3,alt2))).includes('INVALID_BINDING'));
});
test('explicit deletion and complete missing provenance delete rather than infer neighbor',()=>{
  for(const mappings of [[row([base],[])],[]]){
    const r=run([step(2,mappings)],3);
    assert.equal(r.status,'deleted');assert.deepEqual(r.candidates,[]);
  }
});
test('partial coverage and uncertain provider evidence return pending with old revision',()=>{
  const p=run([step(2,[],'partial')],3);
  assert.equal(p.status,'pending_evidence');assert.equal(p.lastObservedRevision,2);
  assert.ok(codes(p).includes('PARTIAL_COVERAGE'));
  const u=run([step(2,[row([base],[alt],'uncertain')])],3);
  assert.equal(u.status,'pending_evidence');assert.ok(codes(u).includes('UNCERTAIN_MAPPING'));
});
test('missing intermediate and trailing transitions are pending, never identity',()=>{
  assert.ok(codes(run([step(3,[row([base],[alt])])],4)).includes('MISSING_STEP'));
  const r=run([step(2,[row([base],[base])])],4);
  assert.equal(r.status,'pending_evidence');assert.equal(r.lastObservedRevision,3);
});
test('unobserved source role returns pending at current revision',()=>{
  const r=resolveSemanticTopologyReference(ref(),snap([]),[],2);
  assert.equal(r.status,'pending_evidence');assert.deepEqual(codes(r),['UNOBSERVED_ANCHOR']);
});
test('unrelated observed feature stays resolved when another is deleted',()=>{
  const other=role('feature.other','role.else');
  const r=resolveSemanticTopologyReference(ref(other),snap([other,base]),[step(2,[row([other],[other]),row([base],[])])],3);
  assert.equal(r.status,'resolved');assert.deepEqual(r.candidates,[other]);
});
test('partial deletion after split leaves reconciliation even with one candidate',()=>{
  const r=run([step(2,[row([base],[alt,alt2])]),step(3,[row([alt],[]),row([alt2],[alt2])])],4);
  assert.equal(r.status,'requires_reconciliation');assert.deepEqual(r.candidates,[alt2]);
});
test('cross-project evidence, mismatched source revision, backward revision fail closed',()=>{
  assert.throws(()=>resolveSemanticTopologyReference(ref(),snap([base],2,'other.project'),[],2),TopologyEvidenceError);
  assert.throws(()=>run([step(2,[row([base],[base])],'complete','other.project')],3),TopologyEvidenceError);
  assert.throws(()=>resolveSemanticTopologyReference(ref(),snap([base],3),[],3),TopologyEvidenceError);
  assert.throws(()=>resolveSemanticTopologyReference(ref(),snap(),[],1),TopologyEvidenceError);
});
test('source and target roles cannot appear in contradictory mapping rows',()=>{
  assert.throws(()=>run([step(2,[row([base],[alt]),row([base],[alt2])])],3),TopologyEvidenceError);
  assert.throws(()=>run([step(2,[row([base],[alt]),row([alt2],[alt])])],3),TopologyEvidenceError);
  assert.throws(()=>run([step(2,[row([base,base],[alt])])],3),TopologyEvidenceError);
});
test('entity-kind switching and repeated snapshot identities fail closed',()=>{
  assert.throws(()=>run([step(2,[row([base],[role('feature.cut','role.e','edge')])])],3),TopologyEvidenceError);
  assert.throws(()=>resolveSemanticTopologyReference(ref(),snap([base,base]),[],2),TopologyEvidenceError);
});
test('unsupported version, reserved property, bad IDs and excessive steps fail closed',()=>{
  assert.throws(()=>parseSemanticTopologyReference({...ref(),version:2}),TopologyEvidenceError);
  assert.throws(()=>parseSemanticTopologyReference({...ref(),anchor:{...base,roleId:'face#12'}}),TopologyEvidenceError);
  assert.throws(()=>parseSemanticTopologyReference({...ref(),...JSON.parse('{"__proto__":1}')}),TopologyEvidenceError);
  assert.throws(()=>run(Array(2049).fill({})),TopologyEvidenceError);
});
test('unsorted, duplicate and out-of-interval evidence is rejected',()=>{
  assert.throws(()=>run([step(2,[row([base],[base])])],2),TopologyEvidenceError);
  assert.throws(()=>run([step(2,[row([base],[base])]),step(2,[row([base],[base])])],4),TopologyEvidenceError);
});
test('replay is deterministic and does not mutate caller source, evidence or choice',()=>{
  const steps=[step(2,[row([base],[alt])])], old=structuredClone(steps), original=ref();
  const first=resolveSemanticTopologyReference(original,snap(),steps,3);
  const second=resolveSemanticTopologyReference(original,snap(),steps,3);
  assert.deepEqual(first,second);assert.deepEqual(steps,old);assert.deepEqual(original,ref());
});
