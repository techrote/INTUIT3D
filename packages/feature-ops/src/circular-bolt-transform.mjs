/**
 * One-shot retrospective ORIENTATION and placement edit of a complete named
 * bolt circle. All holes, including source, move through the accepted RUNTIME
 * rigid-hole transform; SKETCH remains sole geometry/constraint authority.
 * The original pattern is not an associative CAD feature or native B-rep.
 */
export const BOLT_ORIENTATION_FORMAT='intuit3d.feature-ops.bolt-orientation';
export const BOLT_ORIENTATION_VERSION=1;
const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,100}$/;
const PREFIX=/^[A-Za-z][A-Za-z0-9._:-]{0,89}$/;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const fail=m=>{throw new TypeError('feature-ops bolt orientation: '+m);};
function exact(o,fields,label){
 if(!plain(o)||Object.keys(o).length!==fields.length||
    fields.some(key=>!Object.hasOwn(o,key))||
    Object.keys(o).some(key=>!fields.includes(key)))fail('invalid '+label);
}
function id(value,label){
 if(typeof value!=='string'||!IDENT.test(value))fail('invalid '+label);
 return value;
}
const state=(report,featureId)=>report.features?.find(f=>f.featureId===featureId)?.status;
const selected=(entries,id)=>Array.isArray(entries)&&entries.length===1&&entries[0]===id;
const toleranceMm=1e-6; // Only a provenance assertion, not a solver/Boolean tolerance.
function solvedCircles(doc,solver,ids){
 const verified=solver.validateSketch(doc);
 const solution=solver.solveSketch(verified);
 if(solution?.status!=='solved'||!solution.geometry)
  fail('actual solved SKETCH required');
 return ids.map(holeId=>{
  const circle=verified.circles?.find(c=>c.id===holeId);
  const point=solution.geometry.points?.find(p=>p.id===circle?.center);
  const measured=solution.geometry.circles?.find(c=>c.id===holeId);
  if(!circle||!point||!measured||
     ![point.x,point.y,measured.radius].every(finite)||measured.radius<=0)
   fail('named hole missing solved centre or radius');
  return {id:holeId,x:point.x,y:point.y,radius:measured.radius};
 });
}
export function orientCircularBoltPattern(history,request,services){
 exact(request,['format','version','eventId','expectedProjectId','expectedRevision',
  'units','frame','sketchFeatureId','extrudeFeatureId','cutFeatureId',
  'targetBodyId','orientation'],'request');
 if(request.format!==BOLT_ORIENTATION_FORMAT||request.version!==BOLT_ORIENTATION_VERSION||
    request.units!=='mm'||request.frame!=='local_xy')
  fail('unsupported version, units or frame');
 if(!history?.document||request.expectedProjectId!==history.document.projectId||
    !Number.isSafeInteger(request.expectedRevision)||
    request.expectedRevision!==history.document.revision)
  throw new Error('feature-ops bolt orientation: stale project/revision');
 const eventId=id(request.eventId,'eventId');
 const sketchId=id(request.sketchFeatureId,'sketchFeatureId');
 const extrudeId=id(request.extrudeFeatureId,'extrudeFeatureId');
 const cutId=id(request.cutFeatureId,'cutFeatureId');
 const bodyId=id(request.targetBodyId,'targetBodyId');
 if(new Set([sketchId,extrudeId,cutId,bodyId]).size!==4)
  fail('aliased source/feature/body identity');
 exact(request.orientation,['sourceHoleId','idPrefix','instances','pivotXmm','pivotYmm',
   'sweepDegrees','rotateDegrees','translateXmm','translateYmm'],'orientation');
 const {sourceHoleId,idPrefix,instances,pivotXmm,pivotYmm,sweepDegrees,
   rotateDegrees,translateXmm,translateYmm}=request.orientation;
 id(sourceHoleId,'sourceHoleId');
 if(typeof idPrefix!=='string'||!PREFIX.test(idPrefix)||
    !Number.isSafeInteger(instances)||instances<2||instances>32||
    ![pivotXmm,pivotYmm,sweepDegrees,rotateDegrees,translateXmm,translateYmm].every(finite)||
    sweepDegrees===0||Math.abs(sweepDegrees)>360||
    Math.abs(rotateDegrees)>=360||
    (rotateDegrees===0&&translateXmm===0&&translateYmm===0))
  fail('invalid instance count, pivot, signed sweep or nonzero rigid transform');
 const holeIds=[sourceHoleId,...Array.from({length:instances-1},
   (_,i)=>idPrefix+':p'+(i+1))];
 if(holeIds.some(name=>!IDENT.test(name))||new Set(holeIds).size!==holeIds.length)
  fail('aliased or oversized pattern identities');
 const {model,runtime,sketch:solver}=services??{};
 if(typeof model?.featuresOf!=='function'||typeof runtime?.inspect!=='function'||
    typeof runtime?.transformPlateHoles!=='function'||
    typeof solver?.validateSketch!=='function'||typeof solver?.solveSketch!=='function')
  fail('accepted INTENT, SKETCH and RUNTIME services required');
 const features=model.featuresOf(history.document);
 const source=features.find(f=>f.id===sketchId);
 const extrusion=features.find(f=>f.id===extrudeId);
 const cut=features.find(f=>f.id===cutId);
 if(source?.kind!=='sketch'||!source.payload?.sketch||
    !Array.isArray(source.writeTargets)||source.writeTargets.length!==0||
    extrusion?.kind!=='extrude'||!selected(extrusion.writeTargets,bodyId)||
    extrusion.payload?.sourceSketchId!==sketchId||
    !extrusion.dependsOn?.includes(sketchId)||
    cut?.kind!=='cut'||!selected(cut.writeTargets,bodyId)||
    cut.payload?.targetBodyId!==bodyId||cut.payload?.sourceSketchId!==sketchId||
    !cut.dependsOn?.includes(extrudeId)||
    features.some(f=>![extrudeId,cutId].includes(f.id)&&f.writeTargets?.includes(bodyId)))
  fail('selected sketch/extrusion/cut/body lineage is ambiguous');
 const original=source.payload.sketch;
 if(!Array.isArray(original.circles)||!holeIds.every(name=>
     original.circles.some(c=>c.id===name)))
  fail('named circle has missing copy; refusing inferred repair');
 const before=runtime.inspect(history);
 if(before.projectId!==request.expectedProjectId||
    before.revision!==request.expectedRevision||
    state(before,sketchId)!=='analytic_profile_only'||
    state(before,extrudeId)!=='preview_only'||
    state(before,cutId)!=='pending_exact_provider')
  fail('source SKETCH, extrusion and cut are not current admitted intent');
 const positions=solvedCircles(original,solver,holeIds);
 const first=positions[0],dx=first.x-pivotXmm,dy=first.y-pivotYmm;
 const pitch=Math.hypot(dx,dy);
 if(!finite(pitch)||pitch===0)
  fail('source circle coincides with pattern pivot');
 const full=Math.abs(sweepDegrees)===360;
 const step=(sweepDegrees*Math.PI/180)/(full?instances:instances-1);
 for(let i=1;i<positions.length;i++){
  const a=step*i;
  const x=pivotXmm+dx*Math.cos(a)-dy*Math.sin(a);
  const y=pivotYmm+dx*Math.sin(a)+dy*Math.cos(a);
  if(Math.hypot(positions[i].x-x,positions[i].y-y)>toleranceMm||
     Math.abs(positions[i].radius-first.radius)>toleranceMm)
   fail('named copies no longer match solved circular-pattern provenance');
 }
 const rotate=rotateDegrees*Math.PI/180,c=Math.cos(rotate),s=Math.sin(rotate);
 const expected=positions.map(p=>{
  const x=p.x-pivotXmm,y=p.y-pivotYmm;
  return {id:p.id,x:pivotXmm+x*c-y*s+translateXmm,
    y:pivotYmm+x*s+y*c+translateYmm,radius:p.radius};
 });
 if(expected.some(p=>![p.x,p.y].every(finite)))
  fail('transformed centres overflow');
 const result=runtime.transformPlateHoles(history,{
  sketchFeatureId:sketchId,eventId,expectedRevision:request.expectedRevision,
  admission:'require_admissible',holeIds,rotateDegrees,
  translateXmm,translateYmm,pivotXmm,pivotYmm
 });
 if(result?.kind==='refused')
  return {...result,holeIds,exactAuthority:false,independentInteroperability:false};
 if(result?.kind!=='committed'||!result.history?.document||
    result.history.document.projectId!==request.expectedProjectId||
    result.history.document.revision!==request.expectedRevision+1||
    result.report?.projectId!==request.expectedProjectId||
    result.report?.revision!==result.history.document.revision||
    state(result.report,sketchId)!=='analytic_profile_only'||
    state(result.report,cutId)!=='pending_exact_provider')
  throw new Error('feature-ops bolt orientation: RUNTIME did not retain admitted pending intent');
 const next=model.featuresOf(result.history.document)
  .find(f=>f.id===sketchId)?.payload?.sketch;
 const afterIds=next?.circles?.map(c=>c.id);
 if(!afterIds||afterIds.length!==original.circles.length||
    new Set(afterIds).size!==afterIds.length||
    !holeIds.every(name=>afterIds.includes(name))||
    ![sketchId,extrudeId,cutId].every(name=>
     result.invalidation?.invalidatedFeatureIds?.includes(name)))
  throw new Error('feature-ops bolt orientation: stable identities or invalidation lost');
 const actual=solvedCircles(next,solver,holeIds);
 for(let i=0;i<actual.length;i++){
  if(Math.hypot(actual[i].x-expected[i].x,actual[i].y-expected[i].y)>toleranceMm||
     Math.abs(actual[i].radius-expected[i].radius)>toleranceMm)
   throw new Error('feature-ops bolt orientation: RUNTIME result differs from solved rigid transform');
 }
 return {kind:'committed',history:result.history,report:result.report,
  invalidation:result.invalidation,holeIds,
  semanticIds:{sketchId,extrudeId,cutId,bodyId},
  movedPivot:{xMm:pivotXmm+translateXmm,yMm:pivotYmm+translateYmm},
  pitchCircleRadiusMm:pitch,boreRadiusMm:first.radius,
  status:'pending_exact_provider',
  nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:cutId,
    bodyId,sourceRevision:result.history.document.revision,
    compatibility:'not_claimed_ask_RUNTIME_provider',
    exactAuthority:false,independentInteroperability:false},
  exactAuthority:false,independentInteroperability:false};
}
