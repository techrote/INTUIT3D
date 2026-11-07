import type { SketchDocument, SketchGeometry } from './index.mjs';
export const SIGNED_DIMENSION_FIDELITY_VERSION: 1;
/** Diagnostic only: not solver, profile admission or a B-rep certificate. */
export type SignedDistanceFidelityReport = {
  version: 1;
  status: 'verified' | 'rejected';
  reason: 'invalid_input' | 'dimension_precision_lost' | null;
  failedConstraintIds: string[];
  previewOnly: true;
};
export function assessSignedDistanceFidelity(
  sketch: SketchDocument, geometry: SketchGeometry
): SignedDistanceFidelityReport;
