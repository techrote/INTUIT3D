import {assessPolygonBoundary,requireSimplePolygonBoundary,BOUNDARY_GUARD_VERSION} from '../boundary-guard.mjs';
import type {PolygonBoundaryAssessment} from '../boundary-guard.mjs';
const version:1=BOUNDARY_GUARD_VERSION;
const value:PolygonBoundaryAssessment=assessPolygonBoundary([{x:0,y:0},{x:1,y:0},{x:0,y:1}]);
const verified:PolygonBoundaryAssessment=requireSimplePolygonBoundary([{x:0,y:0},{x:1,y:0},{x:0,y:1}]);
void [version,value,verified];


import {assessSeparatedPolygonBoundaries} from '@intuit3d/sketch/boundary-guard/v1';
import type {SeparatedPolygonBoundariesAssessment}
  from '@intuit3d/sketch/boundary-guard/v1';
const a:ReadonlyArray<Readonly<{x:number;y:number}>>=[
  {x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}
];
const b:ReadonlyArray<Readonly<{x:number;y:number}>>=[
  {x:20,y:20},{x:25,y:20},{x:25,y:25},{x:20,y:25}
];
const separation:SeparatedPolygonBoundariesAssessment=
  assessSeparatedPolygonBoundaries(a,b);
if(separation.status==='refused'){
  const reason:'invalid_boundary'|'boundary_contact'|'nested_contour'=
    separation.reason!;
  void reason;
}
