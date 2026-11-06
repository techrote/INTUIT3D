import { plateSketchFixture, solveSketch, editConstraint, type SketchDocument, type SketchSolution, suggestDrag, type DragSuggestion } from '../index.mjs';
const document: SketchDocument = plateSketchFixture();
const solution: SketchSolution = solveSketch(editConstraint(document,'width',{value:130}));
if (solution.status === 'solved') console.log(solution.geometry?.points.length);
// @ts-expect-error units must be millimetres at the v1 boundary
const badUnits: SketchDocument['units'] = 'in';
void badUnits;

const preview: DragSuggestion = suggestDrag(document, document.points[0].id, {x:1,y:2});
const isPreview: true = preview.previewOnly;
void isPreview;
