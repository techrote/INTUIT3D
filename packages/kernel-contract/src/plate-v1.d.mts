// Binary64 millimetre coordinates, not an exact decimal or topology claim.
export declare const PLATE_PROTOCOL: 'intuit3d/kernel/plate-v1';
export declare const EXPERIMENTAL_BACKEND: 'OCP-python-prototype';
export declare const EXPERIMENTAL_OCCT_VERSION: '7.9.3.1';
export type PlateHole = Readonly<{ x: number; y: number; radius: number }>;
export type PlateGeometry = Readonly<{
  width: number; depth: number; thickness: number; holes: readonly PlateHole[];
}>;
export type PlateRequest = Readonly<{
  protocol: typeof PLATE_PROTOCOL;
  requestId: string; featureId: string; revision: number; units: 'mm';
  plate: PlateGeometry; exportStep: boolean;
}>;
export type PlateMetrics = Readonly<{ volumeMm3: number; surfaceAreaMm2: number }>;
export type UnresolvedPlateCode =
  | 'stale_revision' | 'invalid_request' | 'timeout' | 'worker_crash' | 'requires_reconciliation';
export type PlateAssessment = Readonly<{
  kind: 'unresolved'; code: UnresolvedPlateCode; requestId: string;
  featureId: string; revision: number;
}> | Readonly<{
  kind: 'experimental_report'; requestId: string; featureId: string; revision: number;
  backend: typeof EXPERIMENTAL_BACKEND; occtVersion: typeof EXPERIMENTAL_OCCT_VERSION;
  expectedMetrics: PlateMetrics;
  step: 'same_engine_readback_reported' | 'not_requested';
  // Always false: JSON metrics alone cannot establish CAD or STEP authority.
  exactAuthority: false;
  independentInteroperability: false;
}>;
export declare class KernelContractError extends Error {}
// Throws KernelContractError for malformed or unsupported input.
export declare function parsePlateRequest(raw: unknown): PlateRequest;
// An elementary numerical target, never evidence of a valid physical solid.
export declare function expectedPlateMetrics(plate: PlateGeometry): PlateMetrics;
// Throws KernelContractError on dishonest/malformed report or missing revision fence.
export declare function assessPlateResponse(
  request: unknown, response: unknown, options: Readonly<{ currentRevision: number }>
): PlateAssessment;
