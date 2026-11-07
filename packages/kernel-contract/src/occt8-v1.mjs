// Explicit OCCT 8.0.1 C++ backend admission. Same-engine STEP remains
// experimental, not independent interoperability or exact CAD authority.
import { assessOcct8PlateResponse as assessPinned } from './plate-v1.mjs';
export const OCCT8_BACKEND = 'OCCT-cxx-8.0.1';
export const OCCT8_VERSION = '8.0.1';
export function assessOcct8PlateResponse(request, raw, options = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return assessPinned(request, raw, options);
  }
  const {stepSha256, stepVerification, part21Audit, ...report} = raw;
  if (stepVerification !== undefined &&
      !['occt-8.0.1-same-engine', 'occt-7.9.3.1-separate-process'].includes(stepVerification)) {
    throw new Error('unsupported OCCT8 STEP verification provenance');
  }
  if (stepVerification !== undefined && (stepSha256 === undefined || !request?.exportStep)) {
    throw new Error('STEP verification without a requested artifact');
  }
  if (stepSha256 !== undefined &&
      (typeof stepSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(stepSha256))) {
    throw new Error('invalid OCCT 8.0.1 STEP digest');
  }
  if (part21Audit !== undefined &&
      (part21Audit === null || typeof part21Audit !== 'object' ||
       Array.isArray(part21Audit) || Object.keys(part21Audit).length !== 2 ||
       part21Audit.kind !== 'part21-plate-structural-v1' ||
       part21Audit.sha256 !== stepSha256 || !request?.exportStep)) {
    throw new Error('unsupported or mismatched independent STEP plate-subset report');
  }
  const assessment = assessPinned(request, report, options);
  return assessment.kind === 'experimental_report'
    ? {...assessment, artifactSha256: stepSha256 ?? null,
       stepVerification: stepVerification ?? null,
       part21Audit: part21Audit ?? null}
    : assessment;
}
