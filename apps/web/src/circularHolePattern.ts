/**
 * Consumer of accepted RUNTIME circular-hole pattern: no UI-owned geometry,
 * no parallel model state, one revision-fenced model transaction.
 */
import { modelHoleValues, runtime, type ModelSession } from './runtimeSession.ts';
import type { SketchConstraintBatchResult } from '@intuit3d/workflow-runtime';

export interface CircularHolePatternRequest {
  readonly sourceHoleId: string;
  readonly instances: number;
  readonly pivotXmm: number;
  readonly pivotYmm: number;
  readonly sweepDegrees: number;
}

export function patternModelCircularHoles(
  h: ModelSession, request: CircularHolePatternRequest,
): SketchConstraintBatchResult {
  const holes = modelHoleValues(h);
  if (!Object.hasOwn(holes, request.sourceHoleId))
    throw Error('Unknown authored source hole for bolt circle.');
  if (!Number.isSafeInteger(request.instances) ||
      request.instances < 2 || request.instances > 32)
    throw Error('Bolt circle requires 2–32 total hole instances.');
  if (![request.pivotXmm,request.pivotYmm,request.sweepDegrees]
      .every(Number.isFinite) ||
      Math.abs(request.pivotXmm) > 10000 ||
      Math.abs(request.pivotYmm) > 10000 ||
      request.sweepDegrees === 0 || Math.abs(request.sweepDegrees) > 360)
    throw Error('Bolt circle requires a finite pivot (±10,000 mm) and nonzero signed sweep up to 360°.');
  const source = holes[request.sourceHoleId];
  if (source.x === request.pivotXmm && source.y === request.pivotYmm)
    throw Error('Bolt circle pivot must differ from the solved source centre.');
  return runtime.patternCircularHoles(h, {
    sketchFeatureId:'sketch.plate',
    eventId:'workbench.hole.circular.' + h.document.revision,
    expectedRevision:h.document.revision,
    admission:'require_admissible',
    sourceHoleId:request.sourceHoleId,
    idPrefix:'orbit.' + h.document.revision,
    instances:request.instances,
    pivotXmm:request.pivotXmm,
    pivotYmm:request.pivotYmm,
    sweepDegrees:request.sweepDegrees,
  });
}
