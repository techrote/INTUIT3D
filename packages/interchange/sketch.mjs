/**
 * Read-only interchange adapters over the existing SKETCH linear/nonlinear
 * engines. The returned documents are actual native SKETCH v1 documents;
 * no second solver, no B-rep/STEP or authoritative project mutation.
 */
import {createSketch,solveSketch,serializeSketch} from '../sketch/index.mjs';
import {createArcSketch,solveArcSketch,serializeArcSketch} from '../sketch/arc-constraints.mjs';
import {validateDxfSketch} from './dxf.mjs';
export const SKETCH_INTERCHANGE_VERSION=1;
const rad=Math.PI/180,mod=a=>((a%360)+360)%360;
const fail=m=>{throw new TypeError('interchange sketch: '+m);};
const at=(e,a)=>{
  const theta=a*rad,cs=Math.cos(theta),sn=Math.sin(theta);
  // Exactly cardinal unit-circle angles to avoid introducing 1e-15 mm
  // disconnections at the common DXF quadrant endpoints.
  const near=(v,t)=>Math.abs(v-t)<=1e-14;
  const val=v=>near(v,0)?0:near(v,1)?1:near(v,-1)?-1:v;
  return {x:e.center.x+e.radiusMm*val(cs),y:e.center.y+e.radiusMm*val(sn)};
};
function adapter(source,withArcs){
  const d=validateDxfSketch(source);
  if(!withArcs&&d.entities.some(e=>e.kind==='arc'))
    fail('linear SKETCH cannot contain analytic arcs; use toArcSketch (no polygon fallback)');
  const points=[],lines=[],circles=[],arcs=[],constraints=[],provenance=[];
  const seen=new Map();
  function point(p){
    const k=JSON.stringify([p.x,p.y]);
    if(seen.has(k))return seen.get(k);
    const id='p'+points.length;
    points.push({id,x:p.x,y:p.y});
    constraints.push({id:'fixed:'+id,kind:'fixed',point:id,x:p.x,y:p.y});
    seen.set(k,id);return id;
  }
  for(const e of d.entities){
    const id='dxf:'+e.id;
    if(e.kind==='line'){
      lines.push({id,start:point(e.start),end:point(e.end)});
    }else if(e.kind==='circle'){
      const center=point(e.center);
      circles.push(withArcs?{id,center,radiusMm:e.radiusMm}:{id,center,radius:e.radiusMm});
      if(!withArcs)constraints.push({id:'radius:'+id,kind:'radius',circle:id,value:e.radiusMm});
    }else{
      // DXF arcs always run counterclockwise from start angle to end angle.
      arcs.push({id,center:point(e.center),start:point(at(e,mod(e.startAngleDeg))),
        end:point(at(e,mod(e.endAngleDeg))),direction:'ccw'});
    }
    provenance.push({dxfEntityId:e.id,sketchEntityId:id,layer:e.layer,
      sourceEntity:e.sourceEntity??e.kind.toUpperCase(),
      ...(e.sourceHandle?{sourceHandle:e.sourceHandle}:{})});
  }
  const document=withArcs?
    createArcSketch({format:'intuit3d.arc-sketch',version:1,units:'mm',
      points,lines,arcs,circles,constraints}):
    createSketch({version:1,units:'mm',points,lines,circles,constraints});
  return {version:1,kind:withArcs?'arc':'linear',units:'mm',
    sourceUnits:d.sourceUnits,document,provenance,
    status:'analytic_sketch_only',physicalExactness:'not_evaluated'};
}
export function toLinearSketch(dxf){return adapter(dxf,false);}
export function toArcSketch(dxf){return adapter(dxf,true);}
/**
 * Re-export actual SKETCH-solved geometry after a dimension/constraint edit.
 * Recompute and compare the solution rather than trusting a forged preview.
 * Return DXF geometry only; no implied model-journal admission.
 */
export function exportSolvedSketch(admitted,source,solution){
  if(!admitted||admitted.version!==1||!['linear','arc'].includes(admitted.kind)||
    admitted.units!=='mm'||!['mm','in'].includes(admitted.sourceUnits)||
    !Array.isArray(admitted.provenance))fail('invalid adapter receipt');
  const arc=admitted.kind==='arc';
  const document=arc?createArcSketch(source):createSketch(source);
  const signature=arc?serializeArcSketch(document):serializeSketch(document);
  const fresh=arc?solveArcSketch(document):solveSketch(document);
  const status=solution?.status;
  if(solution?.[arc?'sourceSignature':'inputSignature']!==signature||
     status!=='solved'||fresh.status!=='solved'||
     JSON.stringify(solution.geometry)!==JSON.stringify(fresh.geometry))
    fail('unsolved, stale or modified SKETCH solution');
  const points=new Map(fresh.geometry.points.map(p=>[p.id,p]));
  const provenance=new Map(admitted.provenance.map(p=>[p.sketchEntityId,p]));
  const entities=[];
  const put=(id,kind,geometry)=>{
    const meta=provenance.get(id);
    if(!meta)fail('geometry lost DXF provenance: '+id);
    entities.push({id:meta.dxfEntityId,kind,layer:meta.layer,...geometry,
      sourceEntity:meta.sourceEntity,...(meta.sourceHandle?{sourceHandle:meta.sourceHandle}:{})});
  };
  for(const line of document.lines){
    put(line.id,'line',{start:{x:points.get(line.start).x,y:points.get(line.start).y},
      end:{x:points.get(line.end).x,y:points.get(line.end).y}});
  }
  for(const circle of document.circles){
    const p=points.get(circle.center);
    put(circle.id,'circle',{center:{x:p.x,y:p.y},radiusMm:circle.radiusMm??fresh.geometry.circles.find(c=>c.id===circle.id)?.radius});
  }
  if(arc){
    for(const a of fresh.geometry.arcs){
      if(a.direction!=='ccw')fail('DXF export requires CCW arc, no orientation guessing');
      const p=points.get(a.center);
      put(a.id,'arc',{center:{x:p.x,y:p.y},radiusMm:a.radiusMm,
        startAngleDeg:mod(a.startAngleRad/rad),
        endAngleDeg:mod((a.startAngleRad+a.sweepRad)/rad)});
    }
  }
  return validateDxfSketch({version:1,units:'mm',sourceUnits:admitted.sourceUnits,entities});
}
/** Consumer-facing, explicitly non-authoritative import preview. */
export function sketchImportPreview(dxf,{arcs=false}={}){
  const admitted=arcs?toArcSketch(dxf):toLinearSketch(dxf);
  const solution=arcs?solveArcSketch(admitted.document):solveSketch(admitted.document);
  return {admitted,solution,previewOnly:true,stepQualified:false,
    providerSubmissionReady:false,requiresAuthoritativeJournalCommit:true};
}
