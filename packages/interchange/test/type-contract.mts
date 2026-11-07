import {importAsciiDxf,exportAsciiDxf,toLinearSketch,toArcSketch,exportSolvedSketch} from '../index.mjs';
import {solveSketch} from '../../sketch/index.mjs';
import {solveArcSketch} from '../../sketch/arc-constraints.mjs';
import type {DxfSketch,DxfEntity,DxfArc} from '../index.mjs';
const original:DxfSketch=importAsciiDxf('');
const entity:DxfEntity=original.entities[0]!;
if(entity.kind==='arc'){const arc:DxfArc=entity;console.log(arc.startAngleDeg);}
const l=toLinearSketch(original);
const a=toArcSketch(original);
const exported:DxfSketch=exportSolvedSketch(l,l.document,solveSketch(l.document));
const exportedArc:DxfSketch=exportSolvedSketch(a,a.document,solveArcSketch(a.document));
const bytes:string=exportAsciiDxf(exported);
void [bytes,exportedArc];
