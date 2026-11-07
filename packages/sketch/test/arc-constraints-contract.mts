import {
  ARC_SKETCH_VERSION,createArcSketch,solveArcSketch,roundedPlateArcFixture,
  editArcConstraint,buildArcWirePreview,parseArcSketch,serializeArcSketch,
  suggestArcDrag,type ArcConstraint,type ArcSketchGeometry,type ArcWirePreview,
} from '@intuit3d/sketch/arc-constraints/v1';
const version:1=ARC_SKETCH_VERSION;
const source=createArcSketch(roundedPlateArcFixture());
const dimensions:ArcConstraint[]=source.constraints;
const widened=editArcConstraint(source,'plate:width',{value:150});
const solution=solveArcSketch(widened);
const maybeGeometry:ArcSketchGeometry|null=solution.geometry;
const wire:ArcWirePreview=buildArcWirePreview(widened,solution,
  ['bottom','arc1','right','arc2','top','arc3','left','arc0']);
const assertPreviewOnly:false=wire.nativeProfileAdmissible;
const persisted=parseArcSketch(serializeArcSketch(source));
const preview=suggestArcDrag(persisted,'p0',{x:0,y:0});
void [version,dimensions,maybeGeometry,assertPreviewOnly,preview];
