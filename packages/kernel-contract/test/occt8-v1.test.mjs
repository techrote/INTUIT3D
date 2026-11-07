import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOcct8PlateResponse, OCCT8_BACKEND, OCCT8_VERSION} from '../src/occt8-v1.mjs';
import {expectedPlateMetrics,PLATE_PROTOCOL} from '../src/plate-v1.mjs';
const request={protocol:PLATE_PROTOCOL,requestId:'cxx.fixture',featureId:'plate',revision:1,
 units:'mm',plate:{width:120,depth:80,thickness:8,
 holes:[{x:-30,y:0,radius:6},{x:30,y:0,radius:6}]},exportStep:true};
const metrics=()=>({valid:true,solidCount:1,...expectedPlateMetrics(request.plate),
 cylindricalHoles:request.plate.holes.map(h=>({...h,axisZ:1}))});
const response={protocol:PLATE_PROTOCOL,requestId:request.requestId,featureId:request.featureId,
 revision:1,backend:OCCT8_BACKEND,occtVersion:OCCT8_VERSION,status:'validated_exact',
 units:'mm',source:metrics(),stepReadback:metrics(),stepWritten:true,
 stepSha256:'a'.repeat(64),stepPath:'/tmp/non-authoritative.step'};
test('pinned C++ result still has experimental provenance',()=>{
 const assessment=assessOcct8PlateResponse(request,response,{currentRevision:1});
 assert.equal(assessment.kind,'experimental_report');
 assert.equal(assessment.backend,OCCT8_BACKEND);
 assert.equal(assessment.occtVersion,OCCT8_VERSION);
 assert.equal(assessment.exactAuthority,false);
 assert.equal(assessment.independentInteroperability,false);
 assert.equal(assessment.artifactSha256,'a'.repeat(64));
});
test('cross-engine substitution, wrong version, bad digest and stale revision',()=>{
 for(const override of [{backend:'OCP-python-prototype',occtVersion:'7.9.3.1'},
                         {occtVersion:'8.0.0'},{stepSha256:'not-hash'}]){
  assert.throws(()=>assessOcct8PlateResponse(request,{...response,...override},{currentRevision:1}));
 }
 assert.equal(assessOcct8PlateResponse(request,response,{currentRevision:2}).code,'stale_revision');
});
test('missing or displaced cylindrical holes fail admission',()=>{
 assert.throws(()=>assessOcct8PlateResponse(request,
   {...response,source:{...metrics(),cylindricalHoles:[]}},{currentRevision:1}));
 assert.throws(()=>assessOcct8PlateResponse(request,
   {...response,stepReadback:{...metrics(),cylindricalHoles:
     [{x:-29,y:0,radius:6,axisZ:1},{x:30,y:0,radius:6,axisZ:1}]}},{currentRevision:1}));
});
