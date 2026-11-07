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
      const center=op.id+':center',fixed=op.id+':fixed',radius=op.id+':radius';
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
