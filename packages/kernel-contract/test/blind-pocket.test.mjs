import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBodyCutRequest} from '../src/local-body-cut-provider.mjs';
const fixture=new URL('../../../native/examples/l-bracket-separate-cut.request.json',import.meta.url);
test('v2 pocket dimensions are strict and v1 through cuts remain compatible',async()=>{
  const old=JSON.parse(await readFile(fixture,'utf8'));
  assert.equal(validateBodyCutRequest(old),old);
  const pocket={...old,protocol:'intuit3d/kernel/profile-body-cut-v2',cutDepthMm:3};
  assert.equal(validateBodyCutRequest(pocket),pocket);
  for(const depth of [0,-2,9,NaN,Infinity,true,'3']){
    assert.throws(()=>validateBodyCutRequest({...pocket,cutDepthMm:depth}),/pocket depth/);
  }
  assert.throws(()=>validateBodyCutRequest({...old,cutDepthMm:3}),/schema/);
  assert.throws(()=>validateBodyCutRequest({...pocket,arbitrary:true}),/schema/);
});
