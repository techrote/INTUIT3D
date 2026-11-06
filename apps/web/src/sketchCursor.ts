/**
 * Sketch cursor/snap visualization only. This deliberately does NOT admit a
 * SKETCH constraint, move authored geometry, or assert exact B-rep topology.
 * All positions refer to the current SVG preview plane, in millimetres.
 */
export interface PreviewSketchLayout {
  readonly centreX: number;
  readonly centreY: number;
  readonly pixelsPerMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly holePitchMm: number;
}
export type PreviewSnapKind = 'origin' | 'hole-centre' | 'plate-corner' | 'plate-midpoint' | 'grid';
export interface PreviewSnapTarget {
  readonly id: string;
  readonly kind: PreviewSnapKind;
  readonly xMm: number;
  readonly yMm: number;
  readonly distancePx: number;
  readonly featureId: 'sketch-plate' | 'sketch-holes' | null;
}
export interface PreviewSketchCursor {
  /** Raw pointer position, before any visualization-only snapping. */
  readonly rawXmm: number;
  readonly rawYmm: number;
  readonly snap: PreviewSnapTarget | null;
}
/** Explicitly disables profile candidates for inadmissible geometry. */
export interface PreviewSnapOptions {
  readonly allowProfileSnaps: boolean;
  readonly radiusPx?: number;
  readonly gridMm?: number;
}
interface Candidate {
  readonly id: string;
  readonly kind: PreviewSnapKind;
  readonly xMm: number;
  readonly yMm: number;
  readonly featureId: PreviewSnapTarget['featureId'];
}
const PRIORITY: Record<PreviewSnapKind, number> = {
  origin: 0, 'hole-centre': 1, 'plate-corner': 2, 'plate-midpoint': 3, grid: 4,
};

function finiteWithin(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 1e10;
}

/**
 * Read-only cursor inference. Ranking is by actual SVG-pixel distance, then
 * semantic target priority and stable ID. Grid points are NEVER constraints;
 * equal-distance grid anchors cannot displace a genuine profile target.
 */
export function inferPreviewSketchCursor(
  layout: PreviewSketchLayout, xSvg: number, ySvg: number, options: PreviewSnapOptions,
): PreviewSketchCursor {
  const fields = [
    layout.centreX, layout.centreY, layout.pixelsPerMm, layout.widthMm,
    layout.depthMm, layout.holePitchMm, xSvg, ySvg,
  ];
  if (!fields.every(finiteWithin) || layout.pixelsPerMm <= 0 ||
      layout.pixelsPerMm > 1e6 || Math.abs(xSvg) > 1e7 || Math.abs(ySvg) > 1e7) {
    throw new Error('Nonfinite or out-of-range sketch cursor transform');
  }
  const radius = options.radiusPx ?? 14;
  const grid = options.gridMm ?? 10;
  if (!finiteWithin(radius) || radius < 0 || radius > 64 ||
      !finiteWithin(grid) || grid <= 0 || grid > 1e4) {
    throw new Error('Invalid preview snap policy');
  }
  const rawXmm = (xSvg - layout.centreX) / layout.pixelsPerMm;
  const rawYmm = (layout.centreY - ySvg) / layout.pixelsPerMm;
  if (![rawXmm, rawYmm].every(finiteWithin)) throw new Error('Sketch cursor overflow');

  const candidates: Candidate[] = [];
  if (options.allowProfileSnaps && layout.widthMm > 0 && layout.depthMm > 0 &&
      layout.holePitchMm > 0) {
    candidates.push({ id: 'origin', kind: 'origin', xMm: 0, yMm: 0, featureId: 'sketch-plate' });
    for (const sx of [-1, 1] as const) for (const sy of [-1, 1] as const) {
      candidates.push({
        id: `corner-${sx}-${sy}`, kind: 'plate-corner',
        xMm: sx * layout.widthMm / 2, yMm: sy * layout.depthMm / 2, featureId: 'sketch-plate',
      });
    }
    for (const sx of [-1, 1] as const) {
      candidates.push({
        id: `midpoint-x-${sx}`, kind: 'plate-midpoint',
        xMm: sx * layout.widthMm / 2, yMm: 0, featureId: 'sketch-plate',
      });
      candidates.push({
        id: `midpoint-y-${sx}`, kind: 'plate-midpoint',
        xMm: 0, yMm: sx * layout.depthMm / 2, featureId: 'sketch-plate',
      });
      candidates.push({
        id: `hole-${sx}`, kind: 'hole-centre',
        xMm: sx * layout.holePitchMm / 2, yMm: 0, featureId: 'sketch-holes',
      });
    }
  }
  // Bound the rounded grid value and never create Infinity via multiplication.
  const gx = Math.round(rawXmm / grid) * grid;
  const gy = Math.round(rawYmm / grid) * grid;
  if (finiteWithin(gx) && finiteWithin(gy)) {
    candidates.push({ id: 'grid', kind: 'grid', xMm: gx, yMm: gy, featureId: null });
  }

  const eligible = candidates.map((candidate) => ({
    ...candidate,
    distancePx: Math.hypot((rawXmm - candidate.xMm) * layout.pixelsPerMm,
      (rawYmm - candidate.yMm) * layout.pixelsPerMm),
  })).filter((candidate) => Number.isFinite(candidate.distancePx) && candidate.distancePx <= radius);
  eligible.sort((a, b) => {
    const distance = a.distancePx - b.distancePx;
    if (Math.abs(distance) > 1e-9) return distance;
    return PRIORITY[a.kind] - PRIORITY[b.kind] || a.id.localeCompare(b.id);
  });
  const closest = eligible[0];
  return {
    rawXmm,
    rawYmm,
    snap: closest ? { ...closest } : null,
  };
}

/** Readout coordinates are always visual-only and never feed authoring. */
export function formatPreviewCursorMm(value: number): string {
  if (!finiteWithin(value)) throw new Error('Invalid cursor millimetres');
  const rounded = Math.round(value * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}
