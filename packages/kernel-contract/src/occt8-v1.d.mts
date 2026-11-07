import type { PlateAssessment } from './plate-v1.mjs';
export declare const OCCT8_BACKEND: 'OCCT-cxx-8.0.1';
export declare const OCCT8_VERSION: '8.0.1';
type PinnedReport = Extract<PlateAssessment, {kind: 'experimental_report'}>;
export type Occt8Assessment =
  Exclude<PlateAssessment, {kind: 'experimental_report'}> |
  (Omit<PinnedReport, 'backend' | 'occtVersion'> & Readonly<{
     backend: typeof OCCT8_BACKEND;
     occtVersion: typeof OCCT8_VERSION;
     artifactSha256: string | null;
     stepVerification: 'occt-8.0.1-same-engine' | 'occt-7.9.3.1-separate-process' | null;
  }>);
export declare function assessOcct8PlateResponse(
  request: unknown, response: unknown,
  options: Readonly<{currentRevision: number}>
): Occt8Assessment;
