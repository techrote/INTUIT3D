import {assessPolygonBoundary,requireSimplePolygonBoundary,BOUNDARY_GUARD_VERSION} from '../boundary-guard.mjs';
import type {PolygonBoundaryAssessment} from '../boundary-guard.mjs';
const version:1=BOUNDARY_GUARD_VERSION;
const value:PolygonBoundaryAssessment=assessPolygonBoundary([{x:0,y:0},{x:1,y:0},{x:0,y:1}]);
const verified:PolygonBoundaryAssessment=requireSimplePolygonBoundary([{x:0,y:0},{x:1,y:0},{x:0,y:1}]);
void [version,value,verified];
