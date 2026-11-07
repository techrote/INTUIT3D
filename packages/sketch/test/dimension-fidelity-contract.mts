import { assessSignedDistanceFidelity, SIGNED_DIMENSION_FIDELITY_VERSION } from '../dimension-fidelity.mjs';
import type { SignedDistanceFidelityReport } from '../dimension-fidelity.mjs';
import { plateSketchFixture, solveSketch } from '../index.mjs';
const sketch = plateSketchFixture();
const solution = solveSketch(sketch);
if (solution.geometry) {
  const report: SignedDistanceFidelityReport = assessSignedDistanceFidelity(sketch, solution.geometry);
  const version: 1 = SIGNED_DIMENSION_FIDELITY_VERSION;
  const isPreview: true = report.previewOnly;
  void version; void isPreview;
}
