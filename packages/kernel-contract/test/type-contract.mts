import {PLATE_PROTOCOL, parsePlateRequest, assessPlateResponse, type PlateAssessment,
  type PlateRequest} from '../src/plate-v1.mjs';

const raw: PlateRequest = { protocol: PLATE_PROTOCOL, requestId: 'r.1', featureId: 'f.1',
  revision: 1, units: 'mm', plate: { width: 120, depth: 80, thickness: 8, holes: [] }, exportStep: false };
const validated: PlateRequest = parsePlateRequest(raw);
const status: PlateAssessment = assessPlateResponse(validated, {}, {currentRevision: 1});
if (status.kind === 'experimental_report') {
  const authority: false = status.exactAuthority;
  const independent: false = status.independentInteroperability;
  void authority; void independent;
}
// @ts-expect-error only explicitly supported units are permitted
const invalid: PlateRequest = {...raw, units: 'in'};
void invalid;
// @ts-expect-error revision fencing is mandatory
assessPlateResponse(raw, {});
