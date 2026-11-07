/**
 * Structural authoring of circular through-holes in an existing SKETCH document.
 * This is NOT a solver, geometry equivalence oracle, or native Boolean.
 * Caller must pass the result through SKETCH validation/admission and INTENT
 * journal commit. Never delete constraints belonging to other entities.
 */
const HOLE_ID=/^[A-Za-z][\w:.-]{0,110}$/;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function fail(reason){throw new TypeError('runtime holes: '+reason);}
function refs(constraint,circleId,pointId){
  return constraint.point===pointId||constraint.a===pointId||
    constraint.b===pointId||constraint.circle===circleId||
    constraint.a===circleId||constraint.b===circleId;
}
function entityIds(doc){
  return new Set([...doc.points,...doc.lines,...doc.circles,...doc.constraints].map(x=>x.id));
}

/**
 * Bound a single authored batch, retaining all unrelated IDs/constraints.
 * Radius values are SKETCH radius values in mm, never diameters.
 */
export function applyPlateHoleOperations(source,operations){
  if(!Array.isArray(operations)||operations.length<1||operations.length>32)
    fail('1–32 add/remove operations required');
  const doc=structuredClone(source);
  const touched=new Set();
  for(const op of operations){
    if(!op||typeof op!=='object'||Array.isArray(op)||
        !['add','remove'].includes(op.kind)||
        !HOLE_ID.test(op.id||'')||touched.has(op.id))
      fail('invalid or repeated hole identity');
    touched.add(op.id);
    if(op.kind==='add'){
      if(Object.keys(op).sort().join(',')!=='id,kind,radius,x,y'||
          !finite(op.x)||!finite(op.y)||!finite(op.radius)||op.radius<=0)
        fail('add requires finite x/y, positive radius and explicit identity');
      // Existing WORKBENCH names radius-valued constraints ':diameter'.
      const center=op.id+':center',fixed=op.id+':fixed',radius=op.id+':diameter';
      const used=entityIds(doc);
      if([op.id,center,fixed,radius].some(id=>used.has(id)))
        fail('hole or derived entity identity already exists');
      doc.points.push({id:center,x:op.x,y:op.y});
      doc.circles.push({id:op.id,center,radius:op.radius});
      doc.constraints.push({id:fixed,kind:'fixed',point:center,x:op.x,y:op.y},
        {id:radius,kind:'radius',circle:op.id,value:op.radius});
    }else{
      if(Object.keys(op).sort().join(',')!=='id,kind')
        fail('remove requires only an existing circle identity');
      const circle=doc.circles.find(c=>c.id===op.id);
      if(!circle) fail('hole does not exist');
      const center=circle.center;
      if(doc.circles.some(c=>c.id!==circle.id&&c.center===center)||
          doc.lines.some(l=>l.start===center||l.end===center))
        fail('hole centre is shared by other geometry');
      const referenced=doc.constraints.filter(c=>refs(c,circle.id,center));
      const fixed=referenced.filter(c=>c.kind==='fixed'&&c.point===center);
      const radii=referenced.filter(c=>c.kind==='radius'&&c.circle===circle.id);
      if(referenced.length!==2||fixed.length!==1||radii.length!==1)
        fail('hole has dependent or non-owned constraints');
      const drop=new Set(referenced.map(c=>c.id));
      doc.constraints=doc.constraints.filter(c=>!drop.has(c.id));
      doc.circles=doc.circles.filter(c=>c.id!==circle.id);
      doc.points=doc.points.filter(p=>p.id!==center);
    }
  }
  if(!doc.circles.length) fail('cut workflow requires at least one circular hole');
  return doc;
}

/**
 * One-shot rectangular array from the SOLVED geometry of an authored circle.
 * No associative pattern/history is invented: every copy becomes its own
 * stable circle and fixed/radius constraints in one undoable SKETCH edit.
 * Geometry, profile contact and hole containment remain SKETCH/KERNEL's job.
 */
export function planRectangularHoleArray(source,solution,request){
  const {sourceHoleId,idPrefix,columns,rows,pitchXmm,pitchYmm}=request??{};
  if(typeof sourceHoleId!=='string'||!sourceHoleId||
      typeof idPrefix!=='string'||!/^[A-Za-z][\w:.-]{0,89}$/.test(idPrefix)||
      !Number.isSafeInteger(columns)||columns<1||columns>8||
      !Number.isSafeInteger(rows)||rows<1||rows>8||
      rows*columns<2||rows*columns>32||
      !finite(pitchXmm)||!finite(pitchYmm)||
      (columns>1&&pitchXmm===0)||(rows>1&&pitchYmm===0))
    fail('rectangular array needs an authored source, stable prefix, 2–32 cells and nonzero active pitches');
  if(solution?.status!=='solved'||!solution.geometry)
    fail('rectangular array requires actual solved SKETCH geometry');
  const circle=source.circles.find(c=>c.id===sourceHoleId);
  const solvedCircle=solution.geometry.circles?.find(c=>c.id===sourceHoleId);
  const solvedCenter=solution.geometry.points?.find(p=>p.id===circle?.center);
  if(!circle||!solvedCircle||!solvedCenter||
      !finite(solvedCircle.radius)||solvedCircle.radius<=0||
      !finite(solvedCenter.x)||!finite(solvedCenter.y))
    fail('source hole has no usable solved circle and centre');
  const operations=[];
  for(let row=0;row<rows;row++){
    for(let col=0;col<columns;col++){
      if(row===0&&col===0) continue; // original is retained, not re-authored
      const x=solvedCenter.x+col*pitchXmm;
      const y=solvedCenter.y+row*pitchYmm;
      if(!finite(x)||!finite(y)) fail('array coordinates are not finite');
      const id=`${idPrefix}:r${row}c${col}`;
      operations.push({kind:'add',id,x,y,radius:solvedCircle.radius});
    }
  }
  if(source.circles.length+operations.length>64)
    fail('plate-v1 supports at most 64 circular holes');
  return operations;
}

/**
 * One-shot circular array of a SOLVED source hole around a caller-selected
 * pivot. The source is instance 0 and remains untouched; copies have stable
 * independent IDs. Full +/-360 degree sweeps omit the duplicate endpoint,
 * while partial arcs include both endpoints. No associative design intent or
 * native geometric accuracy is claimed by this operation planner.
 */
export function planCircularHolePattern(source,solution,request){
  const {sourceHoleId,idPrefix,instances,pivotXmm,pivotYmm,sweepDegrees=360}=request??{};
  if(typeof sourceHoleId!=='string'||!sourceHoleId||
      typeof idPrefix!=='string'||!/^[A-Za-z][\w:.-]{0,89}$/.test(idPrefix)||
      !Number.isSafeInteger(instances)||instances<2||instances>32||
      !finite(pivotXmm)||!finite(pivotYmm)||
      !finite(sweepDegrees)||sweepDegrees===0||Math.abs(sweepDegrees)>360)
    fail('circular array requires a source, stable prefix, 2–32 instances, finite pivot and nonzero sweep <=360 degrees');
  if(solution?.status!=='solved'||!solution.geometry)
    fail('circular array requires actual solved SKETCH geometry');
  const circle=source.circles.find(c=>c.id===sourceHoleId);
  const solvedCircle=solution.geometry.circles?.find(c=>c.id===sourceHoleId);
  const center=solution.geometry.points?.find(p=>p.id===circle?.center);
  if(!circle||!solvedCircle||!center||
      !finite(solvedCircle.radius)||solvedCircle.radius<=0||
      !finite(center.x)||!finite(center.y))
    fail('source hole has no usable solved circle and centre');
  const dx=center.x-pivotXmm,dy=center.y-pivotYmm;
  const orbitRadius=Math.hypot(dx,dy);
  if(!finite(orbitRadius)||orbitRadius===0)
    fail('circular array pivot must differ from the solved hole centre');
  const fullCircle=Math.abs(sweepDegrees)===360;
  const step=(sweepDegrees*Math.PI/180)/(fullCircle?instances:instances-1);
  const operations=[];
  for(let i=1;i<instances;i++){
    const theta=step*i;
    const c=Math.cos(theta),s=Math.sin(theta);
    const x=pivotXmm+dx*c-dy*s;
    const y=pivotYmm+dx*s+dy*c;
    if(!finite(x)||!finite(y))
      fail('circular array produced non-finite coordinates');
    operations.push({kind:'add',id:`${idPrefix}:p${i}`,x,y,radius:solvedCircle.radius});
  }
  if(source.circles.length+operations.length>64)
    fail('plate-v1 supports at most 64 circular holes');
  return operations;
}
