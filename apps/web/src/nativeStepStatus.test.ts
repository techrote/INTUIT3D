import test from 'node:test';
import assert from 'node:assert/strict';
import {describeNativeStep} from './nativeStepStatus.ts';

type Provider='idle'|'pending'|'evaluated'|'blocked'|'provider_failed'|'cancelled';
type Availability='unavailable'|'current'|'last_good';
const status=(providerState:Provider,stepAvailability:Availability,
  backend:'OCCT-cxx-8.0.1'|'OCP-python-prototype'|null=null,
  canEvaluate=true,lastResultCode:string|null=null)=>
  describeNativeStep({revision:17,providerState,stepAvailability,lastResultCode},
    backend,canEvaluate);

test('unbuilt sketch/cut and stale receipt are never reported as current native geometry',()=>{
  assert.equal(status('idle','unavailable',null,false).phase,'not_ready');
  assert.equal(status('idle','unavailable').phase,'unavailable');
  assert.equal(status('evaluated','current',null).phase,'unavailable');
  assert.match(status('evaluated','current',null).detail,/no current source-matched STEP/i);
});

test('source-fenced OCCT8 C++ and experimental OCP remain separate, neither claims independent geometry',()=>{
  const pinned=status('evaluated','current','OCCT-cxx-8.0.1');
  const experimental=status('evaluated','current','OCP-python-prototype');
  assert.equal(pinned.phase,'current_pinned');
  assert.match(pinned.label,/PINNED C\+\+ STEP/);
  assert.match(pinned.detail,/do not establish independently validated geometry/i);
  assert.equal(experimental.phase,'current_experimental');
  assert.match(experimental.label,/OCP/);
  assert.doesNotMatch(experimental.label,/PINNED/);
});

test('pending, blocked, cancelled and provider failure override retained last-good STEP',()=>{
  const pending=status('pending','last_good','OCCT-cxx-8.0.1');
  assert.equal(pending.phase,'pending');
  assert.match(pending.detail,/LAST GOOD/);
  const failed=status('provider_failed','last_good','OCP-python-prototype',true,'timeout');
  assert.equal(failed.phase,'failed');
  assert.match(failed.detail,/timeout/);
  assert.match(failed.detail,/LAST GOOD/);
  assert.equal(status('blocked','unavailable',null,true,'unsupported_profile').phase,'blocked');
  assert.equal(status('cancelled','last_good','OCCT-cxx-8.0.1').phase,'cancelled');
  assert.equal(status('idle','last_good','OCCT-cxx-8.0.1').phase,'last_good_pinned');
});

test('a provider failure without retained bytes never looks like a ready STEP',()=>{
  const failed=status('provider_failed','unavailable',null,true,'worker_unreachable');
  assert.equal(failed.phase,'failed');
  assert.doesNotMatch(failed.detail,/LAST GOOD/);
  assert.equal(status('pending','unavailable').phase,'pending');
});
