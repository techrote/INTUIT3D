import {PLATE_PROTOCOL, parsePlateRequest, assessPlateResponse, type PlateAssessment,
  type PlateRequest} from '../src/plate-v1.mjs';
import {runExperimentalPlate, type LocalPlateResult} from '../src/local-plate-provider.mjs';
import {runPinnedOcct8Plate, type LocalOcct8Result} from '../src/local-occt8-provider.mjs';

const raw: PlateRequest = { protocol: PLATE_PROTOCOL, requestId: 'r.1', featureId: 'f.1',
  revision: 1, units: 'mm', plate: { width: 120, depth: 80, thickness: 8, holes: [] }, exportStep: false };
const validated: PlateRequest = parsePlateRequest(raw);
const status: PlateAssessment = assessPlateResponse(validated, {}, {currentRevision: 1});
if (status.kind === 'experimental_report') {
  const authority: false = status.exactAuthority;
  const independent: false = status.independentInteroperability;
  void authority; void independent;
}
const execution: Promise<LocalPlateResult> = runExperimentalPlate(raw, {
  readCurrentRevision: () => 1,
});
async function consume() {
  const result = await execution;
  if (result.kind === 'experimental_report') {
    const volume: number = result.observed.source.volumeMm3;
    const noAuthority: false = result.exactAuthority;
    if (result.artifact) {
      const hash: string = result.artifact.sha256;
      void hash;
    }
    void volume; void noAuthority;
  }
}
void consume;
// @ts-expect-error only explicitly supported units are permitted
const invalid: PlateRequest = {...raw, units: 'in'};
void invalid;
// @ts-expect-error revision fencing is mandatory
assessPlateResponse(raw, {});
// @ts-expect-error revision callback is mandatory for local process
runExperimentalPlate(raw, {});

const nativeExecution: Promise<LocalOcct8Result> = runPinnedOcct8Plate(raw, {
  workerExecutable: '/trusted/occt8/bin/intuit3d_occt8_plate',
  readCurrentRevision: () => 1,
});
async function consumeNative() {
  const result = await nativeExecution;
  if (result.kind === 'experimental_report') {
    const authority: false = result.exactAuthority;
    const independent: false = result.independentInteroperability;
    if (result.artifact) {
      const proof: 'occt8_part21_plate_subset' | 'occt8_same_engine_step_readback' =
        result.artifact.verification;
      void proof;
    }
    void authority; void independent;
  }
}
void consumeNative;
// @ts-expect-error pinned C++ executable is mandatory
runPinnedOcct8Plate(raw, {readCurrentRevision: () => 1});

import {runExperimentalArcExtrude, type ArcExtrudeRequest, type ArcExtrudeResult}
  from '../src/local-arc-profile-provider.mjs';
declare const curved: ArcExtrudeRequest;
const curvedExecution: Promise<ArcExtrudeResult> = runExperimentalArcExtrude(curved, {
  readCurrentRevision: () => 1,
});
void curvedExecution;
// @ts-expect-error revision fence mandatory for experimental curved native provider
runExperimentalArcExtrude(curved, {});


import {requestFromRuntimeProfile,runExperimentalRuntimeProfile,
  type MappedRuntimeProfileRequest} from '../src/runtime-profile-provider.mjs';
import type {RuntimeReport} from '@intuit3d/workflow-runtime';
declare const currentReport:RuntimeReport;
const runtimeMapped:MappedRuntimeProfileRequest=requestFromRuntimeProfile(
  currentReport,'extrude.bracket',{requestId:'runtime.native'});
const runtimeExecution=runExperimentalRuntimeProfile(currentReport,'extrude.bracket',{
  requestId:'runtime.native',readCurrentRevision:()=>currentReport.revision});
void runtimeMapped;void runtimeExecution;
// @ts-expect-error runtime profile provider must be revision-fenced
runExperimentalRuntimeProfile(currentReport,'extrude.bracket',{requestId:'runtime.native'});

import {runExperimentalBodyCut, type ProfileBodyCutRequest, type BodyCutResult}
  from '../src/local-body-cut-provider.mjs';
declare const bodyCut: ProfileBodyCutRequest;
const cutResult: Promise<BodyCutResult> = runExperimentalBodyCut(bodyCut,{
  readCurrentRevision:()=>bodyCut.revision
});
void cutResult;
// @ts-expect-error body-cut provider requires an authoritative revision fence
runExperimentalBodyCut(bodyCut,{});


import {requestFromRuntimeBodyCut,runExperimentalRuntimeBodyCut,
  type RuntimeBodyCutServices} from '../src/runtime-body-cut-provider.mjs';
import type {UndoHistory} from '@intuit3d/model/transactions';
declare const journal: UndoHistory;
declare const liveServices: RuntimeBodyCutServices;
const mappedCut: ProfileBodyCutRequest = requestFromRuntimeBodyCut(journal,'cut.window',{
  ...liveServices,requestId:'cut.native.1'});
const executedCut:Promise<BodyCutResult> = runExperimentalRuntimeBodyCut(journal,'cut.window',{
  ...liveServices,requestId:'cut.native.1',
  readCurrentRevision:()=>journal.document.revision});
void mappedCut; void executedCut;
// @ts-expect-error revision callback is compulsory for physical cut publication
runExperimentalRuntimeBodyCut(journal,'cut.window',{...liveServices,requestId:'cut.native'});


import {requestFromRuntimeBodyCutChain,runExperimentalRuntimeBodyCutChain,
  type RuntimeBodyCutChainServices} from '../src/runtime-body-cut-chain-provider.mjs';
declare const chainServices:RuntimeBodyCutChainServices;
const chainMapped=requestFromRuntimeBodyCutChain(journal,'body.bracket',{
  ...chainServices,requestId:'chain.native'});
const chainExecuted=runExperimentalRuntimeBodyCutChain(journal,'body.bracket',{
  ...chainServices,requestId:'chain.native',
  readCurrentRevision:()=>journal.document.revision});
const chainRequest:import('../src/local-body-cut-provider.mjs').BodyCutChainRequest=chainMapped;
void chainRequest;void chainExecuted;
// @ts-expect-error live multi-cut publication must be revision fenced
runExperimentalRuntimeBodyCutChain(journal,'body.bracket',{
  ...chainServices,requestId:'chain.native'});

import {parseOcct8MixedCutRequest,type Occt8MixedCutRequest}
  from '../src/occt8-mixed-cut-v2.mjs';
import {runPinnedOcct8MixedCutChain,type LocalOcct8MixedCutResult}
  from '../src/local-occt8-mixed-cut-provider.mjs';
declare const pinnedMixed:Occt8MixedCutRequest;
const parsedMixed:Occt8MixedCutRequest=parseOcct8MixedCutRequest(pinnedMixed);
const executedMixed:Promise<LocalOcct8MixedCutResult>=runPinnedOcct8MixedCutChain(parsedMixed,{
  workerExecutable:'/trusted/occt8/bin/intuit3d_occt8_plate',
  readCurrentRevision:()=>parsedMixed.revision,
});
void executedMixed;
// @ts-expect-error pinned native mixed cut must be revision fenced
runPinnedOcct8MixedCutChain(parsedMixed,{workerExecutable:'/trusted/occt8'});

// Compile the additive typed selected L-profile request for native consumers.
import type {Occt8LProfileRequest} from '../src/occt8-l-profile-v3.mjs';
import {parseOcct8LProfileRequest} from '../src/occt8-l-profile-v3.mjs';
import {runPinnedOcct8LProfileChain}
  from '../src/local-occt8-l-profile-provider.mjs';
const selectedLProfile:Occt8LProfileRequest={
  protocol:'intuit3d/kernel/l-profile-cut-chain-v3',requestId:'l.types',
  featureId:'body.l',revision:2,units:'mm',exportStep:false,
  profile:{profileId:'sketch.l',width:120,depth:80,
    thickness:8,legWidth:30,footHeight:20},
  cuts:[
    {featureId:'pocket.l',kind:'circle',x:-45,y:10,radius:5,cutDepthMm:3},
    {featureId:'window.l',kind:'rectangle',x:15,y:-30,
      width:10,depth:8,cutDepthMm:8}
  ]
};
const parsedLProfile:Occt8LProfileRequest=parseOcct8LProfileRequest(selectedLProfile);
void parsedLProfile;
void runPinnedOcct8LProfileChain;
