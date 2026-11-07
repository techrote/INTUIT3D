/**
 * INTUIT3D arc-sketch v1: bounded dependency-free NONLINEAR 2-D constraint
 * solver for explicitly authored line/circular-arc geometry in millimetres.
 * Solves Euclidean radius and line/arc tangency simultaneously with linear
 * dimensions. Unlike constructive fillets, tangencies are actual equations.
 * This is analytical SKETCH PREVIEW, not native B-rep/STEP admission.
 */
export const ARC_SKETCH_VERSION = 1;
export const ARC_SKETCH_FORMAT = 'intuit3d.arc-sketch';
const finite = x => typeof x === 'number' && Number.isFinite(x);
const validId = x => typeof x === 'string' && /^[A-Za-z][\w:.-]{0,127}$/.test(x);
const fail = msg => {throw new TypeError('sketch arc: ' + msg);};
const eqKeys = (v, keys, label) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
    Object.keys(v).sort().join('|') !== [...keys].sort().join('|')) fail('invalid ' + label + ' fields');
};
const SERIAL_TOLERANCE_MM = 1e-8;
const PIVOT_RELATIVE = 1e-9;
const MAX_ITERATIONS = 80;

export function createArcSketch(source) {
  eqKeys(source,['format','version','units','points','lines','arcs','circles','constraints'],'document');
  if(source.format!==ARC_SKETCH_FORMAT || source.version!==1 || source.units!=='mm' ||
    !Array.isArray(source.points) || !Array.isArray(source.lines) ||
    !Array.isArray(source.arcs) || !Array.isArray(source.circles) ||
    !Array.isArray(source.constraints)) fail('unsupported schema or units');
  if(source.points.length>128||source.lines.length>128||source.arcs.length>32||
     source.circles.length>32||source.constraints.length>256) fail('bounded solver resource limit exceeded');
  const used=new Set();
  const addId=(entity,label)=>{
    if(!validId(entity.id)||used.has(entity.id))fail('invalid or duplicate '+label+' ID');
    used.add(entity.id);
  };
  for(const p of source.points){
    eqKeys(p,['id','x','y'],'point');addId(p,'point');
    if(!finite(p.x)||!finite(p.y))fail('nonfinite point');
  }
  const points=new Set(source.points.map(p=>p.id));
  for(const l of source.lines){
    eqKeys(l,['id','start','end'],'line');addId(l,'line');
    if(!points.has(l.start)||!points.has(l.end)||l.start===l.end)fail('invalid line endpoints');
  }
  const lines=new Map(source.lines.map(l=>[l.id,l]));
  for(const arc of source.arcs){
    eqKeys(arc,['id','center','start','end','direction'],'arc');addId(arc,'arc');
    if(!points.has(arc.center)||!points.has(arc.start)||!points.has(arc.end)||
      new Set([arc.center,arc.start,arc.end]).size!==3||
      !['ccw','cw'].includes(arc.direction))fail('invalid arc references or direction');
  }
  const arcs=new Map(source.arcs.map(a=>[a.id,a]));
  for(const circle of source.circles){
    eqKeys(circle,['id','center','radiusMm'],'circle');addId(circle,'circle');
    if(!points.has(circle.center)||!finite(circle.radiusMm)||circle.radiusMm<=0)
      fail('invalid circle');
  }
  const pair=c=>points.has(c.a)&&points.has(c.b)&&c.a!==c.b;
  for(const c of source.constraints){
    if(!c||typeof c!=='object'||Array.isArray(c))fail('invalid constraint');
    const keys={
      fixed:['id','kind','point','x','y'],
      horizontal:['id','kind','line'],vertical:['id','kind','line'],
      distanceX:['id','kind','a','b','value'],distanceY:['id','kind','a','b','value'],
      coincident:['id','kind','a','b'],
      arcRadius:['id','kind','arc','value'],
      equalArcRadius:['id','kind','a','b'],
      tangent:['id','kind','arc','line','at']
    }[c.kind];
    if(!keys)fail('unsupported constraint kind '+String(c.kind));
    eqKeys(c,keys,'constraint');addId(c,'constraint');
    if(c.kind==='fixed'&&(!points.has(c.point)||!finite(c.x)||!finite(c.y)))fail('invalid fixed constraint');
    if(['horizontal','vertical'].includes(c.kind)&&!lines.has(c.line))fail('missing line');
    if(['distanceX','distanceY'].includes(c.kind)&&(!pair(c)||!finite(c.value)))fail('invalid distance');
    if(c.kind==='coincident'&&!pair(c))fail('invalid coincidence');
    if(c.kind==='arcRadius'&&(!arcs.has(c.arc)||!finite(c.value)||c.value<=0))fail('invalid radius');
    if(c.kind==='equalArcRadius'&&(!arcs.has(c.a)||!arcs.has(c.b)||c.a===c.b))fail('invalid equal radius');
    if(c.kind==='tangent'){
      const arc=arcs.get(c.arc),line=lines.get(c.line);
      if(!arc||!line||!['start','end'].includes(c.at) ||
        (line.start!==arc[c.at]&&line.end!==arc[c.at]))
        fail('tangent must share an authored point ID with line endpoint');
    }
  }
  // Structured clone avoids author prototype/getter aliases leaking to solvers.
  return structuredClone(source);
}
export const serializeArcSketch = doc=>JSON.stringify(createArcSketch(doc));
export const parseArcSketch = json=>createArcSketch(JSON.parse(json));
export function editArcConstraint(doc,id,patch){
  const next=createArcSketch(doc),c=next.constraints.find(x=>x.id===id);
  if(!c)fail('unknown constraint '+String(id));
  const allowed=c.kind==='fixed'?['x','y']:
    ['distanceX','distanceY','arcRadius'].includes(c.kind)?['value']:[];
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||
     !Object.keys(patch).length||Object.keys(patch).some(k=>!allowed.includes(k)))
    fail('invalid dimension patch');
  Object.assign(c,patch);
  return createArcSketch(next);
}
export function editArcCircleRadius(doc,id,radiusMm){
  const next=createArcSketch(doc),circle=next.circles.find(c=>c.id===id);
  if(!circle||!finite(radiusMm)||radiusMm<=0)fail('invalid circle or radius');
  circle.radiusMm=radiusMm;
  return createArcSketch(next);
}

// Rank classification is separate from least-squares convergence. Pivot is
// relative to the local physical Jacobian scale, not an enlarged CAD tolerance.
function rankOf(A, tol=PIVOT_RELATIVE){
  if(!A.length)return 0;
  const m=A.map(r=>r.slice()),rows=m.length,cols=m[0].length;
  const max=Math.max(1,...m.flat().map(Math.abs)),epsilon=tol*max;
  let rank=0;
  for(let col=0;col<cols&&rank<rows;col++){
    let pivot=rank;
    for(let r=rank+1;r<rows;r++)if(Math.abs(m[r][col])>Math.abs(m[pivot][col]))pivot=r;
    if(Math.abs(m[pivot][col])<=epsilon)continue;
    [m[rank],m[pivot]]=[m[pivot],m[rank]];
    const d=m[rank][col];
    for(let j=col;j<cols;j++)m[rank][j]/=d;
    for(let r=rank+1;r<rows;r++){
      const f=m[r][col];
      if(!f)continue;
      for(let j=col;j<cols;j++)m[r][j]-=f*m[rank][j];
    }
    rank++;
  }
  return rank;
}
function denseSolve(A,b){
  const n=b.length,rows=A.map((row,i)=>[...row,b[i]]);
  for(let i=0;i<n;i++){
    let pivot=i;
    for(let j=i+1;j<n;j++)if(Math.abs(rows[j][i])>Math.abs(rows[pivot][i]))pivot=j;
    if(Math.abs(rows[pivot][i])<1e-20||!finite(rows[pivot][i]))return null;
    [rows[pivot],rows[i]]=[rows[i],rows[pivot]];
    const p=rows[i][i];
    for(let j=i;j<=n;j++)rows[i][j]/=p;
    for(let k=i+1;k<n;k++){
      const f=rows[k][i];
      for(let j=i;j<=n;j++)rows[k][j]-=f*rows[i][j];
    }
  }
  const out=Array(n).fill(0);
  for(let i=n-1;i>=0;i--){
    let s=rows[i][n];
    for(let j=i+1;j<n;j++)s-=rows[i][j]*out[j];
    out[i]=s;
  }
  return out.every(finite)?out:null;
}
function evaluateEquations(doc,x,pointOffset){
  const pts=new Map(doc.points.map(p=>[p.id,{
    x:x[pointOffset.get(p.id)],y:x[pointOffset.get(p.id)+1],
    xi:pointOffset.get(p.id),yi:pointOffset.get(p.id)+1
  }]));
  const lines=new Map(doc.lines.map(l=>[l.id,l]));
  const arcs=new Map(doc.arcs.map(a=>[a.id,a]));
  const results=[],n=x.length;
  function add(id,value,partials=[]){
    const jac=Array(n).fill(0);
    for(const [index,coefficient] of partials)jac[index]+=coefficient;
    results.push({id,value,jac});
  }
  const coord=(id,axis)=>pts.get(id)[axis==='x'?'xi':'yi'];
  const diff=(a,b,axis)=>pts.get(a)[axis]-pts.get(b)[axis];
  function distance(a,b){
    const A=pts.get(a),B=pts.get(b),dx=A.x-B.x,dy=A.y-B.y;
    const d=Math.hypot(dx,dy);
    if(!finite(d)||d<=1e-12)return null;
    return {d,partials:[[A.xi,dx/d],[A.yi,dy/d],[B.xi,-dx/d],[B.yi,-dy/d]]};
  }
  for(const arc of doc.arcs){
    const one=distance(arc.start,arc.center),two=distance(arc.end,arc.center);
    if(!one||!two)return {invalid:'degenerate_arc_radius',entity:arc.id};
    add('implicit:'+arc.id,one.d-two.d,[...one.partials,...two.partials.map(([i,v])=>[i,-v])]);
  }
  for(const c of doc.constraints){
    switch(c.kind){
      case 'fixed':
        add(c.id,pts.get(c.point).x-c.x,[[coord(c.point,'x'),1]]);
        add(c.id,pts.get(c.point).y-c.y,[[coord(c.point,'y'),1]]);
        break;
      case 'horizontal':
      case 'vertical':{
        const line=lines.get(c.line),axis=c.kind==='horizontal'?'y':'x';
        add(c.id,diff(line.end,line.start,axis),[[coord(line.end,axis),1],[coord(line.start,axis),-1]]);
        break;
      }
      case 'distanceX':case 'distanceY':{
        const axis=c.kind==='distanceX'?'x':'y';
        add(c.id,diff(c.b,c.a,axis)-c.value,[[coord(c.b,axis),1],[coord(c.a,axis),-1]]);
        break;
      }
      case 'coincident':
        for(const axis of ['x','y'])add(c.id,diff(c.a,c.b,axis),[[coord(c.a,axis),1],[coord(c.b,axis),-1]]);
        break;
      case 'arcRadius':{
        const a=arcs.get(c.arc),r=distance(a.start,a.center);
        if(!r)return {invalid:'degenerate_arc_radius',entity:a.id};
        add(c.id,r.d-c.value,r.partials);break;
      }
      case 'equalArcRadius':{
        const a=arcs.get(c.a),b=arcs.get(c.b);
        const ra=distance(a.start,a.center),rb=distance(b.start,b.center);
        if(!ra||!rb)return {invalid:'degenerate_arc_radius',entity:c.id};
        add(c.id,ra.d-rb.d,[...ra.partials,...rb.partials.map(([i,v])=>[i,-v])]);break;
      }
      case 'tangent':{
        const arc=arcs.get(c.arc),line=lines.get(c.line);
        const e=pts.get(arc[c.at]),center=pts.get(arc.center);
        const other=pts.get(line.start===arc[c.at]?line.end:line.start);
        const rx=e.x-center.x,ry=e.y-center.y;
        const ux=other.x-e.x,uy=other.y-e.y;
        const L=Math.hypot(ux,uy),dot=rx*ux+ry*uy;
        if(!finite(L)||L<=1e-12)return {invalid:'degenerate_tangent_line',entity:c.id};
        const q=dot/L,u3=dot/(L*L*L);
        const ox=rx/L-u3*ux,oy=ry/L-u3*uy;
        add(c.id,q,[[center.xi,-ux/L],[center.yi,-uy/L],
          [other.xi,ox],[other.yi,oy],
          [e.xi,(ux-rx)/L+u3*ux],[e.yi,(uy-ry)/L+u3*uy]]);
        break;
      }
    }
  }
  return {results};
}
function obviousConflicts(doc){
  const seen=new Map(),bad=new Set();
  for(const c of doc.constraints){
    const entries=c.kind==='fixed'?[[c.point+'.x',c.x],[c.point+'.y',c.y]]:
      c.kind==='arcRadius'?[['arc:'+c.arc,c.value]]:[];
    for(const [key,value] of entries){
      if(seen.has(key)&&seen.get(key).value!==value){bad.add(c.id);bad.add(seen.get(key).id);}
      else seen.set(key,{id:c.id,value});
    }
  }
  return [...bad].sort();
}
function arcSweep(arc,points){
  const center=points.get(arc.center),start=points.get(arc.start),end=points.get(arc.end);
  const a=Math.atan2(start.y-center.y,start.x-center.x);
  const b=Math.atan2(end.y-center.y,end.x-center.x);
  let sweep=b-a;
  if(arc.direction==='ccw'){while(sweep<=0)sweep+=2*Math.PI;}
  else {while(sweep>=0)sweep-=2*Math.PI;}
  return {startAngleRad:a,sweepRad:sweep,radiusMm:Math.hypot(start.x-center.x,start.y-center.y)};
}
export function solveArcSketch(source){
  const doc=createArcSketch(source),sourceSignature=serializeArcSketch(doc);
  const pIndex=new Map(doc.points.map((p,i)=>[p.id,i*2]));
  const seed=doc.points.flatMap(p=>[p.x,p.y]);
  const common={version:1,sourceSignature,solverKind:'bounded_nonlinear_levenberg_marquardt',
    previewOnly:true,exactGeometryAvailable:false,
    numericalPolicy:{residualToleranceMm:SERIAL_TOLERANCE_MM,rankRelativeTolerance:PIVOT_RELATIVE,maxIterations:MAX_ITERATIONS}};
  const direct=obviousConflicts(doc);
  if(direct.length)return {...common,status:'conflicted',geometry:null,rank:null,
    degreesOfFreedom:null,redundantEquations:null,iterations:0,
    diagnostics:[{code:'contradictory_authored_dimensions',candidates:direct}]};
  let x=seed.slice(),lambda=1e-4,iterations=0,evalNow=evaluateEquations(doc,x,pIndex);
  if(evalNow.invalid)return {...common,status:'numerical_failure',geometry:null,
    rank:null,degreesOfFreedom:null,redundantEquations:null,iterations:0,
    diagnostics:[{code:evalNow.invalid,candidates:[evalNow.entity]}]};
  const objective=rows=>rows.reduce((sum,e)=>sum+e.value*e.value,0);
  let score=objective(evalNow.results);
  let best=x.slice(),bestScore=score;
  for(let iteration=0;iteration<MAX_ITERATIONS;iteration++){
    const max=Math.max(0,...evalNow.results.map(e=>Math.abs(e.value)));
    if(max<=SERIAL_TOLERANCE_MM)break;
    const J=evalNow.results.map(e=>e.jac),r=evalNow.results.map(e=>e.value);
    const n=x.length;
    const JTJ=Array.from({length:n},()=>Array(n).fill(0)),rhs=Array(n).fill(0);
    for(let row=0;row<J.length;row++)for(let j=0;j<n;j++){
      rhs[j]-=J[row][j]*r[row];
      if(!J[row][j])continue;
      for(let k=0;k<=j;k++)JTJ[j][k]+=J[row][j]*J[row][k];
    }
    for(let j=0;j<n;j++)for(let k=0;k<j;k++)JTJ[k][j]=JTJ[j][k];
    let accepted=false;
    for(let trial=0;trial<12;trial++){
      const damped=JTJ.map((row,i)=>row.map((v,j)=>i===j?v+lambda:v));
      const delta=denseSolve(damped,rhs);
      if(!delta)break;
      const candidate=x.map((v,i)=>v+delta[i]);
      const next=evaluateEquations(doc,candidate,pIndex);
      if(!next.invalid&&next.results.every(e=>finite(e.value))){
        const candidateScore=objective(next.results);
        if(finite(candidateScore)&&candidateScore<score){
          x=candidate;evalNow=next;score=candidateScore;
          if(score<bestScore){bestScore=score;best=x.slice();}
          lambda=Math.max(1e-12,lambda/3);accepted=true;break;
        }
      }
      lambda=Math.min(1e14,lambda*10);
    }
    iterations++;
    if(!accepted)break;
  }
  x=best;
  evalNow=evaluateEquations(doc,x,pIndex);
  const rows=evalNow.results||[],maxResidual=Math.max(0,...rows.map(e=>Math.abs(e.value)));
  const matrix=rows.map(r=>r.jac),rank=rankOf(matrix),dof=x.length-rank;
  const count=rows.length-rank;
  if(evalNow.invalid||!finite(maxResidual))return {...common,status:'numerical_failure',geometry:null,
    rank,degreesOfFreedom:dof,redundantEquations:null,iterations,
    diagnostics:[{code:evalNow.invalid||'arithmetic_overflow',candidates:[evalNow.entity||'solver']}]};
  if(maxResidual>SERIAL_TOLERANCE_MM){
    const unsatisfied=[...new Set(rows.filter(r=>Math.abs(r.value)>SERIAL_TOLERANCE_MM).map(r=>r.id))].sort();
    return {...common,status:'unresolved',geometry:null,rank,degreesOfFreedom:dof,
      redundantEquations:null,iterations,
      diagnostics:[{code:'constraints_unsatisfied_or_nonconvergent',
        candidates:unsatisfied,maxResidualMm:maxResidual}]};
  }
  const pts=new Map(doc.points.map((p,i)=>[p.id,{id:p.id,x:x[2*i],y:x[2*i+1]}]));
  const arcs=[];
  for(const a of doc.arcs){
    const curve=arcSweep(a,pts);
    // Zero/full circles, doubled-back arcs, or encoded collinear endpoints
    // cannot be turned into a stable open arc by guessing.
    if(!finite(curve.radiusMm)||curve.radiusMm<=0||
      Math.abs(curve.sweepRad)<=1e-8||Math.abs(curve.sweepRad)>=2*Math.PI-1e-8)
      return {...common,status:'unresolved',geometry:null,rank,degreesOfFreedom:dof,
        redundantEquations:null,iterations,
        diagnostics:[{code:'ambiguous_arc_sweep',candidates:[a.id]}]};
    arcs.push({...a,...curve});
  }
  const geometry={units:'mm',points:[...pts.values()],lines:structuredClone(doc.lines),
    arcs,circles:doc.circles.map(c=>({...c}))};
  return {...common,status:dof===0?'solved':'underconstrained',geometry,
    rank,degreesOfFreedom:dof,redundantEquations:count,iterations,
    diagnostics:[...(count>0?[{code:'redundant_constraints',count}]:[]),
      ...(dof>0?[{code:'free_degrees_of_freedom',count:dof}]:[])]};
}
/** Temporary drag equation; never modifies authored dimensions. */
export function suggestArcDrag(source,pointId,target){
  const doc=createArcSketch(source);
  if(!doc.points.some(p=>p.id===pointId)||!target||!finite(target.x)||!finite(target.y))
    fail('invalid drag point/target');
  let id='drag:'+pointId,n=0;
  const ids=new Set([...doc.points,...doc.lines,...doc.arcs,...doc.circles,...doc.constraints].map(e=>e.id));
  while(ids.has(id))id='drag:'+pointId+':'+(++n);
  const next=structuredClone(doc);
  next.constraints.push({id,kind:'fixed',point:pointId,x:target.x,y:target.y});
  const solved=solveArcSketch(next);
  return {version:1,sourceSignature:serializeArcSketch(doc),previewOnly:true,
    status:solved.status,geometry:solved.geometry,diagnostics:solved.diagnostics,
    degreesOfFreedom:solved.degreesOfFreedom,target:{pointId,x:target.x,y:target.y}};
}
/**
 * Ordered closed line/arc preview. No generic global intersection oracle yet;
 * **never** return this as an admitted extrusion wire or exact native profile.
 */
export function buildArcWirePreview(source,solution,boundaryIds,holeIds=[]){
  const doc=createArcSketch(source);
  if(solution?.sourceSignature!==serializeArcSketch(doc)||solution?.status!=='solved'||
     JSON.stringify(solveArcSketch(doc).geometry)!==JSON.stringify(solution.geometry))
    fail('stale, unsolved or modified nonlinear sketch solution');
  if(!Array.isArray(boundaryIds)||boundaryIds.length<3||boundaryIds.length>128||
     !Array.isArray(holeIds)||new Set(boundaryIds).size!==boundaryIds.length||
     new Set(holeIds).size!==holeIds.length)fail('invalid boundary/hole references');
  const curves=new Map([...doc.lines.map(l=>[l.id,{...l,kind:'line'}]),
    ...doc.arcs.map(a=>[a.id,{...a,kind:'arc'}])]);
  const pts=new Map(solution.geometry.points.map(p=>[p.id,p]));
  const arcGeom=new Map(solution.geometry.arcs.map(a=>[a.id,a]));
  const boundary=[];
  let previous=null,first=null,areaTwice=0;
  for(const id of boundaryIds){
    const curve=curves.get(id);
    if(!curve)fail('unknown boundary curve '+String(id));
    if(previous!==null&&previous!==curve.start)fail('unconnected semantic boundary');
    if(first===null)first=curve.start;
    previous=curve.end;
    const a=pts.get(curve.start),b=pts.get(curve.end);
    if(curve.kind==='line'){
      if(Math.hypot(b.x-a.x,b.y-a.y)<=SERIAL_TOLERANCE_MM)fail('degenerate boundary line');
      areaTwice+=a.x*b.y-b.x*a.y;
      boundary.push({kind:'line',id,start:{x:a.x,y:a.y},end:{x:b.x,y:b.y}});
    }else{
      const geom=arcGeom.get(id),c=pts.get(curve.center);
      if(Math.abs(geom.sweepRad)>=Math.PI+1e-8)fail('unsupported major arc in boundary preview');
      areaTwice+=c.x*(b.y-a.y)-c.y*(b.x-a.x)+geom.radiusMm**2*geom.sweepRad;
      boundary.push({kind:'arc',id,center:{x:c.x,y:c.y},start:{x:a.x,y:a.y},
        end:{x:b.x,y:b.y},radiusMm:geom.radiusMm,
        startAngleRad:geom.startAngleRad,sweepRad:geom.sweepRad});
    }
  }
  if(previous!==first)fail('open semantic boundary');
  // Tangency equations alone also admit a reversed-direction line: a radius
  // larger than its adjacent span can fold the wire back on itself. Require
  // aligned traversal tangents at every line/arc transition before exposing
  // even a local preview. This is NOT a global intersection/region oracle.
  const tangent=(part,at)=>{
    if(part.kind==='line')return {
      x:part.end.x-part.start.x,y:part.end.y-part.start.y};
    const p=part[at],sign=Math.sign(part.sweepRad);
    return {x:-sign*(p.y-part.center.y),y:sign*(p.x-part.center.x)};
  };
  for(let i=0;i<boundary.length;i++){
    const left=boundary[i],right=boundary[(i+1)%boundary.length];
    if(left.kind==='line'&&right.kind==='line')continue;
    const u=tangent(left,'end'),v=tangent(right,'start');
    const size=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);
    if(!finite(size)||size===0 ||
       (u.x*v.x+u.y*v.y)/size<=0 ||
       Math.abs(u.x*v.y-u.y*v.x)/size>1e-6)
      fail('boundary has reversed or discontinuous line/arc traversal');
  }
  const circles=new Map(doc.circles.map(c=>[c.id,c]));
  const holes=holeIds.map(id=>{
    const c=circles.get(id);
    if(!c)fail('missing circle '+String(id));
    const p=pts.get(c.center);
    return {id,centerId:c.center,x:p.x,y:p.y,radiusMm:c.radiusMm};
  });
  const signedArea=areaTwice/2;
  const materialArea=Math.abs(signedArea)-holes.reduce((s,h)=>s+Math.PI*h.radiusMm**2,0);
  if(!finite(materialArea)||materialArea<=0)fail('nonpositive preview material area');
  return {version:1,status:'analytic_wire_preview_only',previewOnly:true,
    nativeProfileAdmissible:false,globalSelfIntersectionChecked:false,
    units:'mm',sourceSignature:serializeArcSketch(doc),
    boundary,holes,signedBoundaryAreaMm2:signedArea,estimatedMaterialAreaMm2:materialArea};
}

/** A genuine four-arc/tangent-equation sketch, NOT four constructed fillets. */
export function roundedPlateArcFixture({widthMm=120,heightMm=80,cornerRadiiMm=[4,8,12,6],
  holeRadiiMm=[6,6]}={}){
  if(!finite(widthMm)||!finite(heightMm)||widthMm<=0||heightMm<=0||
     !Array.isArray(cornerRadiiMm)||cornerRadiiMm.length!==4||
     cornerRadiiMm.some(r=>!finite(r)||r<=0)||
     !Array.isArray(holeRadiiMm)||holeRadiiMm.length!==2||
     holeRadiiMm.some(r=>!finite(r)||r<=0))fail('invalid rounded plate dimensions');
  const r=cornerRadiiMm,W=widthMm,H=heightMm;
  const coords=[
    [[0,r[0]],[r[0],0],[r[0],r[0]]],
    [[W-r[1],0],[W,r[1]],[W-r[1],r[1]]],
    [[W,H-r[2]],[W-r[2],H],[W-r[2],H-r[2]]],
    [[r[3],H],[0,H-r[3]],[r[3],H-r[3]]],
  ];
  const points=[];
  const p=(id,x,y)=>points.push({id,x,y});
  p('p0',0,0);p('p1',W,0);p('p2',W,H);p('p3',0,H);
  for(let i=0;i<4;i++){
    const [s,e,c]=coords[i];p('arc'+i+':start',...s);p('arc'+i+':end',...e);p('arc'+i+':center',...c);
  }
  p('holeA:center',W*35/120,H/2);p('holeB:center',W*85/120,H/2);
  const lines=[
    {id:'bottom',start:'arc0:end',end:'arc1:start'},
    {id:'right',start:'arc1:end',end:'arc2:start'},
    {id:'top',start:'arc2:end',end:'arc3:start'},
    {id:'left',start:'arc3:end',end:'arc0:start'},
  ];
  const arcs=Array.from({length:4},(_,i)=>({id:'arc'+i,
    start:'arc'+i+':start',end:'arc'+i+':end',center:'arc'+i+':center',direction:'ccw'}));
  const constraints=[
    {id:'anchor',kind:'fixed',point:'p0',x:0,y:0},
    {id:'plate:width',kind:'distanceX',a:'p0',b:'p1',value:W},
    {id:'plate:bottom',kind:'distanceY',a:'p0',b:'p1',value:0},
    {id:'plate:right',kind:'distanceX',a:'p1',b:'p2',value:0},
    {id:'plate:height',kind:'distanceY',a:'p1',b:'p2',value:H},
    {id:'plate:left',kind:'distanceX',a:'p0',b:'p3',value:0},
    {id:'plate:top',kind:'distanceY',a:'p2',b:'p3',value:0},
    {id:'bottom:y',kind:'distanceY',a:'p0',b:'arc0:end',value:0},
    {id:'right:x',kind:'distanceX',a:'p1',b:'arc1:end',value:0},
    {id:'top:y',kind:'distanceY',a:'p2',b:'arc2:end',value:0},
    {id:'left:x',kind:'distanceX',a:'p3',b:'arc3:end',value:0},
    {id:'horizontal:bottom',kind:'horizontal',line:'bottom'},
    {id:'vertical:right',kind:'vertical',line:'right'},
    {id:'horizontal:top',kind:'horizontal',line:'top'},
    {id:'vertical:left',kind:'vertical',line:'left'},
    {id:'holeA:fixed',kind:'fixed',point:'holeA:center',x:W*35/120,y:H/2},
    {id:'holeB:fixed',kind:'fixed',point:'holeB:center',x:W*85/120,y:H/2},
  ];
  for(let i=0;i<4;i++){
    constraints.push({id:'corner'+i+':radius',kind:'arcRadius',arc:'arc'+i,value:r[i]});
    const prev=['left','bottom','right','top'][i],next=['bottom','right','top','left'][i];
    constraints.push({id:'corner'+i+':tangent_in',kind:'tangent',arc:'arc'+i,line:prev,at:'start'});
    constraints.push({id:'corner'+i+':tangent_out',kind:'tangent',arc:'arc'+i,line:next,at:'end'});
  }
  return createArcSketch({format:ARC_SKETCH_FORMAT,version:1,units:'mm',points,lines,arcs,
    circles:[{id:'holeA',center:'holeA:center',radiusMm:holeRadiiMm[0]},
      {id:'holeB',center:'holeB:center',radiusMm:holeRadiiMm[1]}],constraints});
}
