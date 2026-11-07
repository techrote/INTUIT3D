import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBodyCutRequest}
  from '../src/local-body-cut-provider.mjs';

const fixture=new URL('../../../native/examples/l-bracket-separate-cut.request.json',
  import.meta.url);
const copy=value=>structuredClone(value);
async function makeChain(){
  const seed=JSON.parse(await readFile(fixture,'utf8'));
  const first=copy(seed.cutTool),second=copy(seed.cutTool);
  first.requestId='request.first.tool';first.featureId='tool.first';
  second.requestId='request.second.tool';second.featureId='tool.second';
  return {protocol:'intuit3d/kernel/profile-body-cut-chain-v3',
    requestId:'request.chain',targetBodyId:seed.targetBodyId,
    revision:seed.revision,units:'mm',baseExtrude:seed.baseExtrude,
    cuts:[
      {cutFeatureId:'cut.first',cutTool:first,cutDepthMm:3},
      {cutFeatureId:'cut.second',cutTool:second,cutDepthMm:8}
    ],exportStep:true};
}
test('v3 multi-feature contract preserves v1/v2 and explicit target identity',async()=>{
  const seed=JSON.parse(await readFile(fixture,'utf8'));
  assert.equal(validateBodyCutRequest(seed),seed);
  assert.equal(validateBodyCutRequest({...seed,
    protocol:'intuit3d/kernel/profile-body-cut-v2',cutDepthMm:3}).cutDepthMm,3);
  const chain=await makeChain();
  assert.equal(validateBodyCutRequest(chain),chain);
  assert.deepEqual(chain.cuts.map(c=>c.cutFeatureId),['cut.first','cut.second']);
  assert.equal(chain.targetBodyId,seed.targetBodyId);
});
test('v3 refuses stale, aliased and invalid authored cuts before native launch',async()=>{
  const chain=await makeChain();
  for(const bad of [
    {...chain,revision:8},
    {...chain,cuts:[]},
    {...chain,cuts:[...chain.cuts,chain.cuts[0]]},
    {...chain,cuts:chain.cuts.map((c,i)=>i?{...c,cutFeatureId:'cut.first'}:c)},
    {...chain,cuts:chain.cuts.map((c,i)=>i?{...c,cutDepthMm:9}:c)},
    {...chain,cuts:chain.cuts.map((c,i)=>i?{...c,cutDepthMm:NaN}:c)},
    {...chain,cuts:chain.cuts.map((c,i)=>i?{...c,cutDepthMm:true}:c)},
    {...chain,cuts:chain.cuts.map((c,i)=>i?{...c,
      cutTool:{...c.cutTool,revision:9}}:c)},
    {...chain,extra:'unknown'}
  ])assert.throws(()=>validateBodyCutRequest(bad),TypeError);
});
