/**
 * Pure, bounded 2D inference geometry for the SKETCH v1 preview adapter.
 * No coordinate or inferred relation returned here is authored intent.
 */
const finite = n => typeof n === 'number' && Number.isFinite(n);
const priorities = Object.freeze({point:0, circle_center:1, midpoint:2, circle_quadrant:3, segment:4, circle_perimeter:5, grid:6});
const compareIds = (a,b) => a<b ? -1 : a>b ? 1 : 0;

/** @param {{points: Array<{id:string,x:number,y:number}>, lines: Array<{id:string,start:string,end:string}>,circles:Array<{id:string,center:string,radius:number}>}} geometry
 * @param {{x:number,y:number}} cursor
 * @param {{radiusMm:number,maxCandidates:number,gridMm?:number,excludeIds:string[]}} options */
export function evaluateSnapGeometry(geometry, cursor, options) {
  const excluded = new Set(options.excludeIds);
  const points = new Map(geometry.points.map(p=>[p.id,p]));
  const candidates = [];
  let failure = null;
  const emit = (kind, entityId, suffix, x, y, parameter = null) => {
    if (failure) return;
    if (!finite(x) || !finite(y)) { failure='nonfinite_candidate'; return; }
    const distanceMm = Math.hypot(x-cursor.x,y-cursor.y);
    if (!finite(distanceMm)) { failure='nonfinite_distance'; return; }
    if (distanceMm > options.radiusMm) return;
    candidates.push({id:entityId===null?'grid':`${kind}:${entityId}${suffix?':'+suffix:''}`,
      kind, entityId, x, y, distanceMm,
      ...(parameter === null ? {} : {parameter}) });
  };
  for (const p of geometry.points) {
    if (excluded.has(p.id)) continue;
    emit('point',p.id,'',p.x,p.y);
  }
  for (const line of geometry.lines) {
    if (excluded.has(line.id)) continue;
    const a=points.get(line.start), b=points.get(line.end);
    if (!a || !b) { failure='missing_line_endpoint'; break; }
    const dx=b.x-a.x,dy=b.y-a.y;
    const length=Math.hypot(dx,dy);
    if (!finite(length) || length===0) {failure='degenerate_or_overflowed_line';break;}
    const midpointX=a.x/2+b.x/2, midpointY=a.y/2+b.y/2;
    emit('midpoint',line.id,'',midpointX,midpointY,0.5);
    const tx=cursor.x-a.x,ty=cursor.y-a.y;
    if(!finite(tx)||!finite(ty)){failure='nonfinite_projection';break;}
    const t=Math.max(0,Math.min(1,((tx*(dx/length))+(ty*(dy/length)))/length));
    if(!finite(t)){failure='nonfinite_projection';break;}
    // Endpoint snaps belong to the existing app-owned point IDs.
    if(t>0 && t<1) emit('segment',line.id,'',a.x*(1-t)+b.x*t,a.y*(1-t)+b.y*t,t);
  }
  for (const circle of geometry.circles) {
    if (excluded.has(circle.id)) continue;
    const center=points.get(circle.center);
    if(!center || !finite(circle.radius) || circle.radius<=0){failure='invalid_circle';break;}
    emit('circle_center',circle.id,'',center.x,center.y);
    for(const [key,dx,dy] of [['E',1,0],['N',0,1],['W',-1,0],['S',0,-1]])
      emit('circle_quadrant',circle.id,key,center.x+dx*circle.radius,center.y+dy*circle.radius);
    const ux=cursor.x-center.x,uy=cursor.y-center.y;
    const dist=Math.hypot(ux,uy);
    if(!finite(dist)){failure='nonfinite_circle_projection';break;}
    if(dist>0) emit('circle_perimeter',circle.id,'',center.x+circle.radius*(ux/dist),center.y+circle.radius*(uy/dist));
  }
  if(options.gridMm !== undefined){
    const x=Math.round(cursor.x/options.gridMm)*options.gridMm;
    const y=Math.round(cursor.y/options.gridMm)*options.gridMm;
    emit('grid',null,'',x,y);
  }
  if(failure)return {status:'numerical_failure', reason:failure, candidates:[], selected:null};
  candidates.sort((a,b)=>a.distanceMm-b.distanceMm || priorities[a.kind]-priorities[b.kind] || compareIds(a.id,b.id));
  const retained=candidates.slice(0,options.maxCandidates);
  return {status:retained.length?'ready':'no_candidate', reason:null,candidates:retained,selected:retained[0]??null};
}
