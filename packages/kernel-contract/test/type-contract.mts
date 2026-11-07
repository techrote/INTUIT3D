import {PLATE_PROTOCOL, parsePlateRequest, assessPlateResponse, type PlateAssessment,
  type PlateRequest} from '../src/plate-v1.mjs';
import {runExperimentalPlate, type LocalPlateResult} from '../src/local-plate-provider.mjs';

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

import {runPinnedOcct8Plate, type LocalOcct8Result} from '../src/local-occt8-provider.mjs';
import {assessOcct8PlateResponse} from '../src/occt8-v1.mjs';
const occt8Outcome: Promise<LocalOcct8Result> = runPinnedOcct8Plate(raw, {
  workerExecutable: '/verified/pinned/occt8/worker',
  readCurrentRevision: () => 1,
});
void occt8Outcome;
const occt8Assessed = assessOcct8PlateResponse(raw, {}, {currentRevision: 1});
if (occt8Assessed.kind === 'experimental_report') {
  const notProductionExact: false = occt8Assessed.exactAuthority;
  const notIndependentCad: false = occt8Assessed.independentInteroperability;
  void notProductionExact; void notIndependentCad;
}
