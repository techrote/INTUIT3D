import test from 'node:test';
import assert from 'node:assert/strict';
import {diffWorkflowPlans, WORKFLOW_INVALIDATION_FORMAT} from '../invalidation.mjs';

const f=(id,dependsOn=[],payload={value:1})=>({id,kind:'parameter',dependsOn,payload,writeTargets:[]});
const p=(revision,features,projectId='project')=>({projectId,revision,
  authoredOrder:features.map(x=>x.id),executableOrder:features.map(x=>x.id),
  features:features.map(feature=>({feature,status:'ready',diagnostics:[]}))});

test('scalar change invalidates transitive descendants, not independent branches',()=>{
  const a=f('param'), b=f('sketch',['param']), c=f('plate',['sketch']),
    d=f('cut',['plate']), e=f('independent');
  const r=diffWorkflowPlans(p(2,[a,b,c,d,e]),p(3,[{...a,payload:{value:2}},b,c,d,e]));
  assert.equal(r.format,WORKFLOW_INVALIDATION_FORMAT);
  assert.deepEqual(r.changedFeatureIds,['param']);
  assert.deepEqual(r.invalidatedFeatureIds,['param','sketch','plate','cut']);
  assert.deepEqual(r.unchangedFeatureIds,['independent']);
  assert.equal(r.exactReuseAllowed,false);
});

test('removing dependency invalidates current descendants',()=>{
  const a=f('a'),b=f('b',['a']),c=f('c',['b']);
  const r=diffWorkflowPlans(p(2,[a,b,c]),p(3,[a,{...b,dependsOn:[]},c]));
  assert.deepEqual(r.invalidatedFeatureIds,['b','c']);
});

test('deleted source causes deterministic dependent invalidation',()=>{
  const a=f('a'),b=f('b',['a']),c=f('c',['b']);
  const r=diffWorkflowPlans(p(2,[a,b,c]),p(3,[b,c]));
  assert.deepEqual(r.changedFeatureIds,['a']);
  assert.deepEqual(r.invalidatedFeatureIds,['b','c','a']);
  assert.deepEqual(r.removedFeatureIds,['a']);
});

test('satisfying future-target dependency invalidates waiting branch',()=>{
  const b=f('b',['future']),c=f('c',['b']);
  const r=diffWorkflowPlans(p(2,[b,c]),p(3,[b,c,f('future')]));
  assert.deepEqual(r.changedFeatureIds,['future']);
  assert.deepEqual(r.invalidatedFeatureIds,['b','c','future']);
});

test('unchanged features after revision bump cannot claim exact cache reuse',()=>{
  const a=f('a');const r=diffWorkflowPlans(p(2,[a]),p(3,[a]));
  assert.deepEqual(r.invalidatedFeatureIds,[]);
  assert.deepEqual(r.unchangedFeatureIds,['a']);
  assert.equal(r.exactReuseAllowed,false);
});

test('cyclic closure terminates and invalidates every descendant',()=>{
  const a=f('a',['b']),b=f('b',['a']),c=f('c',['a']);
  const r=diffWorkflowPlans(p(3,[a,b,c]),p(4,[{...a,payload:{value:2}},b,c]));
  assert.deepEqual(r.invalidatedFeatureIds,['a','b','c']);
});

test('reject cross-project, reverse, duplicate and same-revision mutations',()=>{
  const a=f('a');
  assert.throws(()=>diffWorkflowPlans(p(1,[a]),p(2,[a],'other')),/different projects/);
  assert.throws(()=>diffWorkflowPlans(p(2,[a]),p(1,[a])),/reverse revision/);
  assert.throws(()=>diffWorkflowPlans(p(1,[a,a]),p(2,[a])),/duplicate model feature/);
  assert.throws(()=>diffWorkflowPlans(p(1,[a]),p(1,[{...a,payload:{value:2}}])),/same-revision/);
});

test('long dependency chain closes iteratively without stack overflow',()=>{
  const count=12000;
  const features=Array.from({length:count},(_,i)=>f('id.'+i,i?['id.'+(i-1)]:[]));
  const after=[{...features[0],payload:{value:2}},...features.slice(1)];
  const r=diffWorkflowPlans(p(2,features),p(3,after));
  assert.equal(r.invalidatedFeatureIds.length,count);
});
