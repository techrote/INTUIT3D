import {validateSketch,serializeSketch,solveSketch,buildPlateProfile} from './index.mjs';
/**
 * Bounded analytic right-angle fillet solver. Tangencies are constructed,
 * not fitted; no general nonlinear sketch or B-rep authority is claimed.
 */
export const ROUNDED_PLATE_VERSION=1;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const err=s=>{throw new TypeError('sketch rounded plate: '+s);};
const id=x=>typeof x==='string'&&/^[A-Za-z][\w:.-]{0,127}$/.test(x);
export function createRoundedPlateIntent(source){
  if(!source||typeof source!=='object'||Array.isArray(source)||
     Object.keys(source).sort().join(',')!=='edgeIds,holeIds,id,radiusMm,version'||
     source.version!==1||!id(source.id))err('invalid versioned fillet intent');
  if(!Array.isArray(source.edgeIds)||source.edgeIds.length!==4||
     !source.edgeIds.every(id)||new Set(source.edgeIds).size!==4)
    err('four distinct directed rectangle edges required');
  if(!Array.isArray(source.holeIds)||source.holeIds.length>64||
     !source.holeIds.every(id)||new Set(source.holeIds).size!==source.holeIds.length)
    err('invalid hole IDs');
  if(!finite(source.radiusMm)||source.radiusMm<=0)err('positive finite corner radius required');
  return structuredClone(source);
}
export const serializeRoundedPlateIntent=source=>JSON.stringify(createRoundedPlateIntent(source));
export const parseRoundedPlateIntent=json=>createRoundedPlateIntent(JSON.parse(json));
export const editRoundedPlateRadius=(source,radiusMm)=>createRoundedPlateIntent({...createRoundedPlateIntent(source),radiusMm});

const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function segmentDistance(p,a,b){
  const vx=b.x-a.x,vy=b.y-a.y,denominator=vx*vx+vy*vy;
  if(!finite(denominator)||denominator===0)return NaN;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*vx+(p.y-a.y)*vy)/denominator));
  return Math.hypot(p.x-a.x-t*vx,p.y-a.y-t*vy);
}
function arcDistance(p,arc){
  const dx=p.x-arc.center.x,dy=p.y-arc.center.y;
  let nearest=Math.min(dist(p,arc.start),dist(p,arc.end));
  if(dx*arc.cornerSigns.x>=0&&dy*arc.cornerSigns.y>=0)
    nearest=Math.min(nearest,Math.abs(Math.hypot(dx,dy)-arc.radiusMm));
  return nearest;
}
/** Refuse rotated, nonrectangular, unrepresentable and welded-by-guess outlines. */
function rectangle(outer){
  if(outer.length!==4)err('four rectangle vertices required');
  const xs=outer.map(p=>p.x),ys=outer.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=maxX-minX,height=maxY-minY;
  if(!finite(width)||!finite(height)||width<=0||height<=0||
     new Set(outer.map(p=>String(p.x)+':'+String(p.y))).size!==4||
     !outer.every(p=>(p.x===minX||p.x===maxX)&&(p.y===minY||p.y===maxY)))
    err('outer profile is not a rectangle');
  const directions=[],turns=[];
  for(let i=0;i<4;i++){
    const a=outer[i],b=outer[(i+1)%4],c=outer[(i+2)%4];
    const dx=b.x-a.x,dy=b.y-a.y,nx=c.x-b.x,ny=c.y-b.y;
    const len=Math.hypot(dx,dy),nextLen=Math.hypot(nx,ny);
    if(!finite(len)||!finite(nextLen)||len<=0||nextLen<=0||
      (dx!==0&&dy!==0)||(nx!==0&&ny!==0)||dx*nx+dy*ny!==0)
      err('only four orthogonal axis-aligned rectangle edges supported');
    directions.push({x:dx/len,y:dy/len});
    turns.push(Math.sign(dx*ny-dy*nx));
  }
  if(!turns[0]||turns.some(t=>t!==turns[0]))err('inconsistent polygon turning direction');
  return {minX,maxX,minY,maxY,width,height,orientation:turns[0],directions};
}
function cornersFor(vertices,rect,radii){
  return vertices.map((v,i)=>{
    const r=radii[i];
    const incoming=rect.directions[(i+3)%4],outgoing=rect.directions[i];
    const start={x:v.x-r*incoming.x,y:v.y-r*incoming.y};
    const end={x:v.x+r*outgoing.x,y:v.y+r*outgoing.y};
    const center={x:start.x+r*outgoing.x,y:start.y+r*outgoing.y};
    if([start.x,start.y,end.x,end.y,center.x,center.y].some(x=>!finite(x))||
       dist(start,v)===0||dist(end,v)===0||dist(start,end)===0)
      err('fillet geometry not representable at encoded coordinate scale');
    return {start,end,center,radiusMm:r,cornerSigns:{x:Math.sign(v.x-center.x),y:Math.sign(v.y-center.y)}};
  });
}
function materialize(base,intent,radii){
  const vertices=base.outer,rect=rectangle(vertices);
  if(radii.length!==4||radii.some(r=>!finite(r)||r<=0))
    err('four positive finite corner radii required');
  const budget=Math.max(1e-9,1e-12*Math.max(rect.width,rect.height,...radii));
  for(let i=0;i<4;i++){
    const j=(i+1)%4,span=dist(vertices[i],vertices[j]);
    if(!finite(radii[i]+radii[j])||radii[i]+radii[j]+budget>=span)
      err('corner radii leave no unambiguous straight profile edges');
  }
  const corners=cornersFor(vertices,rect,radii),edges=[],arcs=[],boundary=[];
  for(let i=0;i<4;i++){
    const j=(i+1)%4,c=corners[j],r=c.radiusMm;
    const line={kind:'line',id:intent.id+':line:'+intent.edgeIds[i],
      sourceEdgeId:intent.edgeIds[i],start:corners[i].end,end:c.start};
    const arc={kind:'arc',id:intent.id+':arc:'+vertices[j].id,
      sourceVertexId:vertices[j].id,center:c.center,start:c.start,end:c.end,
      radiusMm:r,startAngleRad:Math.atan2(c.start.y-c.center.y,c.start.x-c.center.x),
      sweepRad:rect.orientation*Math.PI/2,cornerSigns:c.cornerSigns};
    if(dist(line.start,line.end)<=budget)err('fillet straight segment too short for numerical policy');
    edges.push(line);arcs.push(arc);boundary.push(line,{...arc,cornerSigns:undefined});
  }
  // Hole/fillet contact is different from hole/rectangle contact. Revalidate.
  for(const hole of base.holes){
    const p={x:hole.x,y:hole.y};
    if(!finite(hole.radius)||hole.radius<=0||
       p.x<=rect.minX||p.x>=rect.maxX||p.y<=rect.minY||p.y>=rect.maxY)
      err('hole '+hole.id+' outside rounded plate');
    for(const a of arcs){
      const x=(p.x-a.center.x)*a.cornerSigns.x,y=(p.y-a.center.y)*a.cornerSigns.y;
      if(x>=0&&y>=0&&Math.hypot(x,y)>=a.radiusMm-budget)
        err('hole '+hole.id+' center outside rounded corner');
    }
    const clearance=Math.min(...edges.map(e=>segmentDistance(p,e.start,e.end)),
      ...arcs.map(a=>arcDistance(p,a)))-hole.radius;
    if(!finite(clearance)||clearance<=budget)
      err('hole '+hole.id+' touches or crosses rounded boundary');
  }
  const areaMm2=base.areaMm2-(1-Math.PI/4)*radii.reduce((sum,r)=>sum+r*r,0);
  if(!finite(areaMm2)||areaMm2<=0||areaMm2===base.areaMm2)
    err('rounded profile area not representable');
  return {status:'analytic_curved_profile_only',previewOnly:true,units:'mm',
    intentId:intent.id,
    ...(intent.version===1?{radiusMm:intent.radiusMm}:
      {cornerRadiiMm:Object.fromEntries(vertices.map((v,i)=>[v.id,radii[i]]))}),
    orientation:rect.orientation,
    boundary,holes:structuredClone(base.holes),areaMm2,numericalClearanceBudgetMm:budget};
}
/**
 * Rerun authoritative linear constraints and base profile admission on each
 * call. If a dependency is unsolved, retain the authored fillet and refuse
 * derived geometry. No caller-controlled cached solution is admitted.
 */
export function solveRoundedPlate(sketchSource,intentSource){
  const sketch=validateSketch(sketchSource),intent=createRoundedPlateIntent(intentSource);
  const common={version:1,sourceSignature:serializeSketch(sketch),
    intentSignature:serializeRoundedPlateIntent(intent),
    solverKind:'constructive_right_angle_fillet_only',
    generalNonlinearSolver:false,previewOnly:true};
  const solved=solveSketch(sketch);
  if(solved.status!=='solved')return {...common,status:solved.status,
    baseDegreesOfFreedom:solved.degreesOfFreedom,geometry:null,
    diagnostics:structuredClone(solved.diagnostics)};
  const ids=new Set([...sketch.points,...sketch.lines,...sketch.circles,...sketch.constraints].map(x=>x.id));
  if(ids.has(intent.id))err('fillet intent ID collides with sketch entity');
  try{
    const base=buildPlateProfile(sketch,solved,intent.edgeIds,intent.holeIds);
    return {...common,status:'solved',baseDegreesOfFreedom:0,
      geometry:materialize(base,intent,base.outer.map(()=>intent.radiusMm)),diagnostics:[]};
  }catch(e){
    return {...common,status:'conflicted',baseDegreesOfFreedom:0,geometry:null,
      diagnostics:[{code:'rounded_profile_invalid',
        message:e instanceof Error?e.message:'rounded profile construction failed'}]};
  }
}

/**
 * Rounded plate v2: a separate radius dimension at each authored rectangle
 * corner. An analytic constrained-construction solve (not a general nonlinear
 * constraint optimizer). A radius drag changes only the selected corner.
 * Stable arc IDs are attached to authored vertex IDs, not kernel topology.
 */
export const VARIABLE_ROUNDED_PLATE_VERSION=2;
export function createVariableRoundedPlateIntent(source){
  if(!source||typeof source!=='object'||Array.isArray(source)||
     Object.keys(source).sort().join(',')!=='cornerRadii,edgeIds,holeIds,id,version'||
     source.version!==2)err('invalid versioned variable-fillet intent');
  // Reuse the established closed v1 ID and edge-reference checks.
  createRoundedPlateIntent({version:1,id:source.id,edgeIds:source.edgeIds,
    holeIds:source.holeIds,radiusMm:1});
  if(!Array.isArray(source.cornerRadii)||source.cornerRadii.length!==4)
    err('four distinct authored vertex radii required');
  const seen=new Set();
  for(const entry of source.cornerRadii){
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||
       Object.keys(entry).sort().join(',')!=='radiusMm,vertexId'||
       !id(entry.vertexId)||seen.has(entry.vertexId)||
       !finite(entry.radiusMm)||entry.radiusMm<=0)
      err('invalid or duplicate authored corner radius');
    seen.add(entry.vertexId);
  }
  const intent=structuredClone(source);
  intent.cornerRadii.sort((a,b)=>a.vertexId.localeCompare(b.vertexId,'en'));
  return intent;
}
export const serializeVariableRoundedPlateIntent=source=>
  JSON.stringify(createVariableRoundedPlateIntent(source));
export const parseVariableRoundedPlateIntent=json=>
  createVariableRoundedPlateIntent(JSON.parse(json));
export function editVariableRoundedPlateRadius(source,vertexId,radiusMm){
  const intent=createVariableRoundedPlateIntent(source);
  if(!id(vertexId)||!intent.cornerRadii.some(e=>e.vertexId===vertexId)||
     !finite(radiusMm)||radiusMm<=0)err('unknown corner or nonpositive radius');
  return createVariableRoundedPlateIntent({...intent,cornerRadii:
    intent.cornerRadii.map(e=>e.vertexId===vertexId?{...e,radiusMm}:e)});
}
export function solveVariableRoundedPlate(sketchSource,intentSource){
  const sketch=validateSketch(sketchSource),intent=createVariableRoundedPlateIntent(intentSource);
  const common={version:2,sourceSignature:serializeSketch(sketch),
    intentSignature:serializeVariableRoundedPlateIntent(intent),
    solverKind:'constructive_independent_right_angle_fillets_only',
    generalNonlinearSolver:false,previewOnly:true};
  const solved=solveSketch(sketch);
  if(solved.status!=='solved')return {...common,status:solved.status,
    baseDegreesOfFreedom:solved.degreesOfFreedom,geometry:null,
    diagnostics:structuredClone(solved.diagnostics)};
  const ids=new Set([...sketch.points,...sketch.lines,...sketch.circles,...sketch.constraints].map(x=>x.id));
  if(ids.has(intent.id))err('fillet intent ID collides with sketch entity');
  try{
    const base=buildPlateProfile(sketch,solved,intent.edgeIds,intent.holeIds);
    const radiiByVertex=new Map(intent.cornerRadii.map(e=>[e.vertexId,e.radiusMm]));
    if(base.outer.length!==4||base.outer.some(v=>!radiiByVertex.has(v.id))||
       new Set(base.outer.map(v=>v.id)).size!==4)
      err('fillet radius targets do not match authored boundary vertices');
    const radii=base.outer.map(v=>radiiByVertex.get(v.id));
    return {...common,status:'solved',baseDegreesOfFreedom:0,
      geometry:materialize(base,intent,radii),diagnostics:[]};
  }catch(e){
    return {...common,status:'conflicted',baseDegreesOfFreedom:0,geometry:null,
      diagnostics:[{code:'rounded_profile_invalid',
        message:e instanceof Error?e.message:'rounded profile construction failed'}]};
  }
}
export function inspectVariableRoundedPlateHandles(sketchSource,intentSource){
  const sketch=validateSketch(sketchSource),intent=createVariableRoundedPlateIntent(intentSource);
  const result=solveVariableRoundedPlate(sketch,intent);
  const base={version:2,sketchSignature:serializeSketch(sketch),
    intentSignature:serializeVariableRoundedPlateIntent(intent),
    status:result.status,diagnostics:structuredClone(result.diagnostics),
    previewOnly:true,geometry:result.geometry,handles:[]};
  if(result.status!=='solved')return base;
  const handles=result.geometry.boundary.filter(e=>e.kind==='arc').map(e=>({
    kind:'corner_radius',id:'corner-radius:'+e.sourceVertexId,
    sourceVertexId:e.sourceVertexId,
    position:structuredClone(e.start),valueMm:e.radiusMm
  }));
  return {...base,handles};
}
export function dragVariableRoundedPlateCorner(sketchSource,intentSource,request){
  const sketch=validateSketch(sketchSource),intent=createVariableRoundedPlateIntent(intentSource);
  if(!request||typeof request!=='object'||request.version!==2||
     typeof request.handleId!=='string'||!request.target||
     !finite(request.target.x)||!finite(request.target.y))
    err('invalid versioned corner drag');
  const inspection=inspectVariableRoundedPlateHandles(sketch,intent);
  if(request.expectedSketchSignature!==inspection.sketchSignature||
     request.expectedIntentSignature!==inspection.intentSignature)
    err('stale edit: authored sketch or fillet intent changed');
  if(inspection.status!=='solved')err('solve authored constraints before dragging');
  const handle=inspection.handles.find(h=>h.id===request.handleId);
  if(!handle)err('unknown corner handle');
  const point=solveSketch(sketch).geometry.points.find(p=>p.id===handle.sourceVertexId);
  if(!point)err('missing authored corner');
  const ux=(point.x-handle.position.x)/handle.valueMm,
    uy=(point.y-handle.position.y)/handle.valueMm;
  const radius=(point.x-request.target.x)*ux+(point.y-request.target.y)*uy;
  const common={version:2,sourceSketchSignature:inspection.sketchSignature,
    sourceIntentSignature:inspection.intentSignature,previewOnly:true};
  if(!finite(radius)||radius<=0)
    return {...common,status:'rejected',sketch:null,intent:null,geometry:null,
      diagnostics:[{code:'nonpositive_drag_radius',message:'Corner radius must be positive'}],
      projection:null};
  const nextIntent=editVariableRoundedPlateRadius(intent,handle.sourceVertexId,radius);
  const next=solveVariableRoundedPlate(sketch,nextIntent);
  const appliedPoint={x:point.x-radius*ux,y:point.y-radius*uy};
  return {...common,status:next.status,sketch,intent:nextIntent,
    geometry:next.geometry,diagnostics:structuredClone(next.diagnostics),
    projection:{target:structuredClone(request.target),appliedPoint,
      deviationMm:Math.hypot(appliedPoint.x-request.target.x,
        appliedPoint.y-request.target.y)}};
}
