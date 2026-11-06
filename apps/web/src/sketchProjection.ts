/**
 * Fail-closed conversion from browser client pixels to SVG viewBox coordinates.
 * Affine inverse is explicit so the implementation is deterministic and testable
 * without DOM/browser mocks. Missing or degenerate screen transforms are NOT the
 * sketch origin; a provisional gesture must cancel instead of authoring one.
 */
export interface SketchScreenAffine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}
export interface SketchSvgPoint { readonly x: number; readonly y: number }

export function projectClientToSketchSvg(
  clientX: number, clientY: number, matrix: SketchScreenAffine | null,
): SketchSvgPoint | null {
  if (!matrix || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const { a, b, c, d, e, f } = matrix;
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  const norm = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (norm < 1e-12 || norm > 1e12) return null;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) / norm / norm <= 1e-12) return null;
  const dx = clientX - e;
  const dy = clientY - f;
  const x = (d * dx - c * dy) / determinant;
  const y = (a * dy - b * dx) / determinant;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) return null;
  return { x, y };
}
