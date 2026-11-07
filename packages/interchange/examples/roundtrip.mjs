import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {importAsciiDxf,exportAsciiDxf,toLinearSketch,exportSolvedSketch} from '../index.mjs';
import {editConstraint,solveSketch,buildPlateProfile} from '../../sketch/index.mjs';
const input=new URL('../fixtures/plate-120x80.dxf',import.meta.url);
const output=process.argv[2]??fileURLToPath(new URL('./edited-150x80.dxf',import.meta.url));
const imported=importAsciiDxf(await readFile(input,'utf8')),receipt=toLinearSketch(imported);
const lines=receipt.document.lines;
let edited=editConstraint(receipt.document,'fixed:'+lines[0].end,{x:150});
edited=editConstraint(edited,'fixed:'+lines[1].end,{x:150});
edited=editConstraint(edited,'radius:'+receipt.document.circles[0].id,{value:7});
const solved=solveSketch(edited);
if(solved.status!=='solved')throw new Error('SKETCH did not solve: '+solved.status);
const profile=buildPlateProfile(edited,solved,lines.map(x=>x.id),edited.circles.map(x=>x.id));
const dxf=exportAsciiDxf(exportSolvedSketch(receipt,edited,solved));
await writeFile(output,dxf,'ascii');
const reimport=importAsciiDxf(await readFile(output,'utf8'));
console.log(JSON.stringify({
 output,source:'real SKETCH v1',dxfEntities:reimport.entities.length,
 plateWidthMm:150,plateHeightMm:80,holeRadiiMm:profile.holes.map(h=>h.radius),
 analyticAreaMm2:profile.areaMm2,units:reimport.sourceUnits,
 sketchStatus:solved.status,qualification:'analytic_2d_only_not_BREP_or_STEP'
},null,2));
