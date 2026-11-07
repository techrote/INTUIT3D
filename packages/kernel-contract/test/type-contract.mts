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
