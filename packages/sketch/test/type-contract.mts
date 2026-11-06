import { plateSketchFixture, solveSketch, editConstraint, type SketchDocument, type SketchSolution } from '../index.mjs';
const document: SketchDocument = plateSketchFixture();
const solution: SketchSolution = solveSketch(editConstraint(document,'width',{value:130}));
if (solution.status === 'solved') console.log(solution.geometry?.points.length);
// @ts-expect-error units must be millimetres at the v1 boundary
const badUnits: SketchDocument['units'] = 'in';
void badUnits;
