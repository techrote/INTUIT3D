import type { Document, DimensionKey } from './model.ts';

/** Browser-preview-only file replacement review. Neither input is an exact CAD document. */
export interface DimensionDifference {
  readonly key: DimensionKey;
  readonly previousMm: number;
  readonly incomingMm: number;
}
export interface ReplacementReview {
  readonly changedDimensions: readonly DimensionDifference[];
  readonly nameChanged: boolean;
  readonly referenceChanged: boolean;
  readonly chronologyChanged: boolean;
  readonly currentOperations: number;
  readonly incomingOperations: number;
}

/** Compare authored preview intent, not meshes; distinguish signed zero if encoded. */
export function inspectReplacement(current: Document, incoming: Document): ReplacementReview {
  const changedDimensions = (Object.keys(current.params) as DimensionKey[])
    .filter((key) => !Object.is(current.params[key], incoming.params[key]))
    .map((key) => ({ key, previousMm: current.params[key], incomingMm: incoming.params[key] }));
  return {
    changedDimensions,
    nameChanged: current.name !== incoming.name || current.id !== incoming.id,
    referenceChanged: current.futureReference !== incoming.futureReference ||
      current.referenceResolved !== incoming.referenceResolved,
    chronologyChanged: current.chronology.length !== incoming.chronology.length ||
      current.chronology.some((item, index) => item !== incoming.chronology[index]),
    currentOperations: current.chronology.length,
    incomingOperations: incoming.chronology.length,
  };
}

/** Prevent older asynchronous File.text() resolutions from replacing a newer selection. */
export class PreviewImportGate {
  private generation = 0;
  begin(): number { return ++this.generation; }
  isCurrent(ticket: number): boolean { return Number.isSafeInteger(ticket) && ticket > 0 && ticket === this.generation; }
  invalidate(): void { this.generation++; }
}
