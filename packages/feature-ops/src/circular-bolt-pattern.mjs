/**
 * FEATUREOPS circular-bolt-pattern/v1.
 *
 * Use RUNTIME's *existing* solved-SKETCH circular-hole pattern and atomic
 * admission. This adapter binds the selection to one explicit cut-bearing body
 * and refuses unqualified geometry or inferred body provenance. A pattern is
 * ONE-SHOT: its copies are independent sketch holes, not an associative B-rep.
 */
export const CIRCULAR_BOLT_PATTERN_FORMAT='intuit3d.feature-ops.circular-bolt-pattern';
export const CIRCULAR_BOLT_PATTERN_VERSION=1;

const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,100}$/;
const PREFIX=/^[A-Za-z][A-Za-z0-9._:-]{0,89}$/;
const finite=x=>typeof x==='number' && Number.isFinite(x);
const fail=message=>{throw new TypeError('feature-ops bolt circle: '+message);};
const plain=x=>x!==null && typeof x==='object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function exact(o,names,label) {
  if(!plain(o)||Object.keys(o).length!==names.length||
    names.some(name=>!Object.hasOwn(o,name))||
    Object.keys(o).some(name=>!names.includes(name))) fail('invalid '+label);
}
function id(x,label) {
  if(typeof x!=='string'||!IDENT.test(x)) fail('invalid '+label);
  return x;
}
const reportState=(report,id)=>report.features?.find(f=>f.featureId===id);
const same=(values,value)=>Array.isArray(values)&&values.length===1&&values[0]===value;

/**
 * Author 2–32 circular hole instances on a selected solved SKETCH profile:
 * instance 0 is the original hole, subsequent holes get deterministic IDs
 * from the explicitly supplied prefix. No geometry coordinates are computed
 * here; RUNTIME reads the real SKETCH solution and performs the only commit.
 */
export function authorCircularBoltPattern(history,request,services) {
  exact(request,['format','version','eventId','expectedProjectId','expectedRevision',
    'units','frame','sketchFeatureId','extrudeFeatureId','cutFeatureId',
    'targetBodyId','pattern'],'request');
  if(request.format!==CIRCULAR_BOLT_PATTERN_FORMAT||
    request.version!==CIRCULAR_BOLT_PATTERN_VERSION||
    request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported version, units or frame');
  if(!history?.document||request.expectedProjectId!==history.document.projectId||
    !Number.isSafeInteger(request.expectedRevision)||
    request.expectedRevision!==history.document.revision)
    throw new Error('feature-ops bolt circle: stale project/revision');
  const eventId=id(request.eventId,'eventId');
  const sketchId=id(request.sketchFeatureId,'sketchFeatureId');
  const extrudeId=id(request.extrudeFeatureId,'extrudeFeatureId');
  const cutId=id(request.cutFeatureId,'cutFeatureId');
  const bodyId=id(request.targetBodyId,'targetBodyId');
  if(new Set([sketchId,extrudeId,cutId,bodyId]).size!==4)
    fail('aliased sketch, feature or body identity');

  exact(request.pattern,['sourceHoleId','idPrefix','instances',
    'pivotXmm','pivotYmm','sweepDegrees'],'pattern');
  const {sourceHoleId,idPrefix,instances,pivotXmm,pivotYmm,sweepDegrees}=request.pattern;
  id(sourceHoleId,'sourceHoleId');
  if(typeof idPrefix!=='string'||!PREFIX.test(idPrefix)||
     !Number.isSafeInteger(instances)||instances<2||instances>32||
     ![pivotXmm,pivotYmm,sweepDegrees].every(finite)||
     sweepDegrees===0||Math.abs(sweepDegrees)>360)
    fail('invalid circular pattern count, prefix, pivot or sweep');
  const {runtime,model}=services??{};
  if(typeof runtime?.inspect!=='function'||typeof runtime?.patternCircularHoles!=='function'||
     typeof model?.featuresOf!=='function')
    fail('accepted INTENT and RUNTIME pattern services required');
  const features=model.featuresOf(history.document);
  const sketch=features.find(f=>f.id===sketchId);
  const extrusion=features.find(f=>f.id===extrudeId);
  const cut=features.find(f=>f.id===cutId);
  if(sketch?.kind!=='sketch'||!sketch.payload?.sketch||
     !Array.isArray(sketch.writeTargets)||sketch.writeTargets.length!==0||
     extrusion?.kind!=='extrude'||!same(extrusion.writeTargets,bodyId)||
     extrusion.payload?.sourceSketchId!==sketchId||
     !extrusion.dependsOn?.includes(sketchId)||
     cut?.kind!=='cut'||!same(cut.writeTargets,bodyId)||
     cut.payload?.targetBodyId!==bodyId||cut.payload?.sourceSketchId!==sketchId||
     !cut.dependsOn?.includes(extrudeId)||
     features.some(f=>f.id!==extrudeId&&f.id!==cutId&&f.writeTargets?.includes(bodyId)))
    fail('selected sketch, extrusion, cut or body lineage is ambiguous');
  const original=sketch.payload.sketch;
  if(!Array.isArray(original.circles)||
     !original.circles.some(circle=>circle.id===sourceHoleId)||
     original.circles.length+instances-1>64)
    fail('selected circle missing or SKETCH hole capacity exceeded');
  const generatedIds=Array.from({length:instances-1},
    (_,i)=>idPrefix+':p'+(i+1));
  const occupied=new Set([
    ...(original.points??[]),...(original.lines??[]),
    ...original.circles,...(original.constraints??[])
  ].map(entity=>entity.id));
  for(const holeId of generatedIds) {
    if([holeId,holeId+':center',holeId+':fixed',holeId+':diameter']
       .some(derived=>occupied.has(derived)))
      fail('copy or derived entity identity already exists');
  }
  const before=runtime.inspect(history);
  if(before.projectId!==request.expectedProjectId||
     before.revision!==request.expectedRevision||
     reportState(before,sketchId)?.status!=='analytic_profile_only'||
     reportState(before,extrudeId)?.status!=='preview_only'||
     reportState(before,cutId)?.status!=='pending_exact_provider')
    fail('selected source has no admitted current SKETCH, preview extrusion and pending cut');
  const result=runtime.patternCircularHoles(history,{
    sketchFeatureId:sketchId,eventId,expectedRevision:request.expectedRevision,
    admission:'require_admissible',sourceHoleId,idPrefix,instances,
    pivotXmm,pivotYmm,sweepDegrees
  });
  if(result?.kind==='refused')
    return {...result,generatedHoleIds:generatedIds,
      exactAuthority:false,independentInteroperability:false};
  if(result?.kind!=='committed'||!result.history?.document||
     result.history.document.revision!==request.expectedRevision+1||
     result.report?.projectId!==request.expectedProjectId||
     result.report?.revision!==result.history.document.revision||
     reportState(result.report,sketchId)?.status!=='analytic_profile_only'||
     reportState(result.report,cutId)?.status!=='pending_exact_provider')
    throw new Error('feature-ops bolt circle: RUNTIME did not retain admitted pending intent');
  const updated=model.featuresOf(result.history.document).find(f=>f.id===sketchId);
  const afterIds=new Set(updated?.payload?.sketch?.circles?.map(c=>c.id));
  if(!afterIds?.has(sourceHoleId)||
     !generatedIds.every(holeId=>afterIds.has(holeId))||
     afterIds.size!==original.circles.length+generatedIds.length||
     ![sketchId,extrudeId,cutId].every(featureId=>
       result.invalidation?.invalidatedFeatureIds?.includes(featureId)))
    throw new Error('feature-ops bolt circle: source/copies or dependent invalidation lost');
  return {kind:'committed',history:result.history,report:result.report,
    invalidation:result.invalidation,generatedHoleIds:generatedIds,
    semanticIds:{sketchId,extrudeId,cutId,bodyId},
    pattern:{sourceHoleId,idPrefix,instances,pivotXmm,pivotYmm,sweepDegrees},
    status:'pending_exact_provider',
    nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:cutId,
      bodyId,sourceRevision:result.history.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}


/**
 * Retrospectively resize a complete, still-regular bolt circle. The original
 * hole AND every stable named copy participate in a single RUNTIME edit.
 * This avoids the common error of moving copies while stranding the source
 * at its old pitch radius. No associative history/physical B-rep is implied.
 *
 * An independently moved/deleted/reshaped copy is NOT silently put back into
 * a guessed pattern: the exact selected solved geometry must still agree with
 * the explicitly supplied sweep and pivot to a fixed 1e-6 mm diagnostic
 * provenance check. SKETCH and RUNTIME own all admission and mutation.
 */
export function resizeCircularBoltPattern(history,request,services) {
  exact(request,['format','version','eventId','expectedProjectId','expectedRevision',
    'units','frame','sketchFeatureId','extrudeFeatureId','cutFeatureId',
    'targetBodyId','pattern'],'request');
  if(request.format!==CIRCULAR_BOLT_PATTERN_FORMAT||
     request.version!==CIRCULAR_BOLT_PATTERN_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported version, units or frame');
  if(!history?.document||request.expectedProjectId!==history.document.projectId||
     !Number.isSafeInteger(request.expectedRevision)||
     request.expectedRevision!==history.document.revision)
    throw new Error('feature-ops bolt circle resize: stale project/revision');
  const eventId=id(request.eventId,'eventId');
  const sketchId=id(request.sketchFeatureId,'sketchFeatureId');
  const extrudeId=id(request.extrudeFeatureId,'extrudeFeatureId');
  const cutId=id(request.cutFeatureId,'cutFeatureId');
  const bodyId=id(request.targetBodyId,'targetBodyId');
  if(new Set([sketchId,extrudeId,cutId,bodyId]).size!==4)
    fail('aliased sketch, feature or body identity');
  exact(request.pattern,['sourceHoleId','idPrefix','instances','pivotXmm',
    'pivotYmm','sweepDegrees','pitchCircleScale','boreRadiusScale'],'resize pattern');
  const {sourceHoleId,idPrefix,instances,pivotXmm,pivotYmm,sweepDegrees,
    pitchCircleScale,boreRadiusScale}=request.pattern;
  id(sourceHoleId,'sourceHoleId');
  if(typeof idPrefix!=='string'||!PREFIX.test(idPrefix)||
     !Number.isSafeInteger(instances)||instances<2||instances>32||
     ![pivotXmm,pivotYmm,sweepDegrees,pitchCircleScale,boreRadiusScale].every(finite)||
     sweepDegrees===0||Math.abs(sweepDegrees)>360||
     pitchCircleScale<=0||boreRadiusScale<=0||
     (pitchCircleScale===1&&boreRadiusScale===1))
    fail('invalid sweep, pivot, pitch-circle or bore-radius edit');
  const holeIds=[sourceHoleId,...Array.from({length:instances-1},
    (_,i)=>idPrefix+':p'+(i+1))];
  if(holeIds.some(holeId=>!IDENT.test(holeId))||
     new Set(holeIds).size!==holeIds.length)
    fail('duplicate or oversized pattern identities');
  const {model,runtime,sketch:solver}=services??{};
  if(typeof model?.featuresOf!=='function'||typeof runtime?.inspect!=='function'||
     typeof runtime?.resizePlateHoleLayout!=='function'||
     typeof solver?.validateSketch!=='function'||typeof solver?.solveSketch!=='function')
    fail('accepted INTENT, SKETCH and RUNTIME services required');
  const features=model.featuresOf(history.document);
  const source=features.find(f=>f.id===sketchId);
  const extrusion=features.find(f=>f.id===extrudeId);
  const cut=features.find(f=>f.id===cutId);
  if(source?.kind!=='sketch'||!source.payload?.sketch||
     !Array.isArray(source.writeTargets)||source.writeTargets.length!==0||
     extrusion?.kind!=='extrude'||!same(extrusion.writeTargets,bodyId)||
     extrusion.payload?.sourceSketchId!==sketchId||
     !extrusion.dependsOn?.includes(sketchId)||
     cut?.kind!=='cut'||!same(cut.writeTargets,bodyId)||
     cut.payload?.targetBodyId!==bodyId||cut.payload?.sourceSketchId!==sketchId||
     !cut.dependsOn?.includes(extrudeId)||
     features.some(f=>f.id!==extrudeId&&f.id!==cutId&&f.writeTargets?.includes(bodyId)))
    fail('selected sketch, extrusion, cut or target-body lineage is ambiguous');
  const original=source.payload.sketch;
  if(!Array.isArray(original.circles)||!holeIds.every(holeId=>
     original.circles.some(c=>c.id===holeId)))
    fail('named bolt circle has missing copies; refusing inferred repair');
  const before=runtime.inspect(history);
  if(before.projectId!==request.expectedProjectId||
     before.revision!==request.expectedRevision||
     reportState(before,sketchId)?.status!=='analytic_profile_only'||
     reportState(before,extrudeId)?.status!=='preview_only'||
     reportState(before,cutId)?.status!=='pending_exact_provider')
    fail('source has no admitted current SKETCH, extrusion and pending cut');
  const verified=solver.validateSketch(original);
  const solved=solver.solveSketch(verified);
  if(solved?.status!=='solved')fail('selected SKETCH is not solved');
  const positions=holeIds.map(holeId=>{
    const circle=verified.circles.find(c=>c.id===holeId);
    const center=solved.geometry?.points?.find(p=>p.id===circle?.center);
    const radius=solved.geometry?.circles?.find(c=>c.id===holeId)?.radius;
    if(!center||![center.x,center.y,radius].every(finite)||radius<=0)
      fail('selected hole lacks solved centre or radius');
    return {x:center.x,y:center.y,radius};
  });
  const first=positions[0],dx=first.x-pivotXmm,dy=first.y-pivotYmm;
  const priorPitchRadius=Math.hypot(dx,dy);
  if(!finite(priorPitchRadius)||priorPitchRadius===0)
    fail('bolt circle source coincides with pivot');
  const full=Math.abs(sweepDegrees)===360;
  const step=(sweepDegrees*Math.PI/180)/(full?instances:instances-1);
  const provenanceToleranceMm=1e-6;
  for(let i=1;i<positions.length;i++){
    const angle=step*i;
    const expectedX=pivotXmm+dx*Math.cos(angle)-dy*Math.sin(angle);
    const expectedY=pivotYmm+dx*Math.sin(angle)+dy*Math.cos(angle);
    if(Math.hypot(positions[i].x-expectedX,positions[i].y-expectedY)>
         provenanceToleranceMm||
       Math.abs(positions[i].radius-first.radius)>provenanceToleranceMm)
      fail('existing copies no longer match selected solved bolt-circle provenance');
  }
  if(!finite(priorPitchRadius*pitchCircleScale)||
     !finite(first.radius*boreRadiusScale)||
     priorPitchRadius*pitchCircleScale<=0||first.radius*boreRadiusScale<=0)
    fail('scaled dimensions overflow');
  const result=runtime.resizePlateHoleLayout(history,{
    sketchFeatureId:sketchId,eventId,expectedRevision:request.expectedRevision,
    admission:'require_admissible',holeIds,pivotXmm,pivotYmm,
    scaleX:pitchCircleScale,scaleY:pitchCircleScale,radiusScale:boreRadiusScale
  });
  if(result?.kind==='refused')return {...result,holeIds,
    exactAuthority:false,independentInteroperability:false};
  if(result?.kind!=='committed'||!result.history?.document||
     result.history.document.projectId!==request.expectedProjectId||
     result.history.document.revision!==request.expectedRevision+1||
     result.report?.projectId!==request.expectedProjectId||
     result.report?.revision!==result.history.document.revision||
     reportState(result.report,sketchId)?.status!=='analytic_profile_only'||
     reportState(result.report,cutId)?.status!=='pending_exact_provider')
    throw new Error('feature-ops bolt circle resize: RUNTIME did not retain admitted pending intent');
  const next=model.featuresOf(result.history.document)
    .find(f=>f.id===sketchId)?.payload?.sketch;
  const afterIds=next?.circles?.map(c=>c.id);
  if(!afterIds||afterIds.length!==original.circles.length||
     new Set(afterIds).size!==afterIds.length||
     !holeIds.every(holeId=>afterIds.includes(holeId))||
     ![sketchId,extrudeId,cutId].every(featureId=>
       result.invalidation?.invalidatedFeatureIds?.includes(featureId)))
    throw new Error('feature-ops bolt circle resize: identities or invalidation lost');
  return {kind:'committed',history:result.history,report:result.report,
    invalidation:result.invalidation,holeIds,
    semanticIds:{sketchId,extrudeId,cutId,bodyId},
    dimensions:{previousPitchCircleRadiusMm:priorPitchRadius,
      newPitchCircleRadiusMm:priorPitchRadius*pitchCircleScale,
      previousBoreRadiusMm:first.radius,newBoreRadiusMm:first.radius*boreRadiusScale},
    status:'pending_exact_provider',
    nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:cutId,
      bodyId,sourceRevision:result.history.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
