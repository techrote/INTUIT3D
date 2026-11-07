// Explicit OCCT 8.0.1 C++ backend admission. Same-engine STEP remains
// experimental, not independent interoperability or exact CAD authority.
import { assessOcct8PlateResponse as assessPinned } from './plate-v1.mjs';
export const OCCT8_BACKEND = 'OCCT-cxx-8.0.1';
export const OCCT8_VERSION = '8.0.1';
export function assessOcct8PlateResponse(request, raw, options = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return assessPinned(request, raw, options);
  }
  const {stepSha256, ...report} = raw;
  if (stepSha256 !== undefined &&
      (typeof stepSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(stepSha256))) {
    throw new Error('invalid OCCT 8.0.1 STEP digest');
  }
  const assessment = assessPinned(request, report, options);
  return assessment.kind === 'experimental_report'
    ? {...assessment, artifactSha256: stepSha256 ?? null}
    : assessment;
}
