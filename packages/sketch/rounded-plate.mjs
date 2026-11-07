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
function cornersFor(vertices,rect,r){
  return vertices.map((v,i)=>{
    const incoming=rect.directions[(i+3)%4],outgoing=rect.directions[i];
    const start={x:v.x-r*incoming.x,y:v.y-r*incoming.y};
    const end={x:v.x+r*outgoing.x,y:v.y+r*outgoing.y};
    const center={x:start.x+r*outgoing.x,y:start.y+r*outgoing.y};
    if([start.x,start.y,end.x,end.y,center.x,center.y].some(x=>!finite(x))||
       dist(start,v)===0||dist(end,v)===0||dist(start,end)===0)
      err('fillet geometry not representable at encoded coordinate scale');
    return {start,end,center,cornerSigns:{x:Math.sign(v.x-center.x),y:Math.sign(v.y-center.y)}};
  });
}
function materialize(base,intent){
  const vertices=base.outer,rect=rectangle(vertices),r=intent.radiusMm;
  const budget=Math.max(1e-9,1e-12*Math.max(rect.width,rect.height,r));
  if(!finite(2*r)||2*r+budget>=Math.min(rect.width,rect.height))
    err('corner radius leaves no unambiguous straight profile edges');
  const corners=cornersFor(vertices,rect,r),edges=[],arcs=[],boundary=[];
  for(let i=0;i<4;i++){
    const j=(i+1)%4,c=corners[j];
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
      if(x>=0&&y>=0&&Math.hypot(x,y)>=r-budget)
        err('hole '+hole.id+' center outside rounded corner');
    }
    const clearance=Math.min(...edges.map(e=>segmentDistance(p,e.start,e.end)),
      ...arcs.map(a=>arcDistance(p,a)))-hole.radius;
    if(!finite(clearance)||clearance<=budget)
      err('hole '+hole.id+' touches or crosses rounded boundary');
  }
  const areaMm2=base.areaMm2-(4-Math.PI)*r*r;
  if(!finite(areaMm2)||areaMm2<=0||areaMm2===base.areaMm2)
    err('rounded profile area not representable');
  return {status:'analytic_curved_profile_only',previewOnly:true,units:'mm',
    intentId:intent.id,radiusMm:r,orientation:rect.orientation,
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
      geometry:materialize(base,intent),diagnostics:[]};
  }catch(e){
    return {...common,status:'conflicted',baseDegreesOfFreedom:0,geometry:null,
      diagnostics:[{code:'rounded_profile_invalid',
        message:e instanceof Error?e.message:'rounded profile construction failed'}]};
  }
}
