/**
 * FEATUREOPS rectangular-hole-grid/v1.
 * This is semantic authoring of independent SKETCH holes, not an associative
 * CAD pattern, B-rep Boolean, alternate solver or native STEP provider.
 * RUNTIME alone computes generated positions, performs SKETCH admission and
 * commits the revision-fenced authoritative transaction.
 */
export const RECTANGULAR_HOLE_GRID_FORMAT='intuit3d.feature-ops.rectangular-hole-grid';
export const RECTANGULAR_HOLE_GRID_VERSION=1;

const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,100}$/;
const PREFIX=/^[A-Za-z][A-Za-z0-9._:-]{0,89}$/;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fail=reason=>{throw new TypeError('feature-ops grid: '+reason);};
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);
function exact(value,fields,label){
  if(!plain(value)||Object.keys(value).length!==fields.length||
      fields.some(field=>!Object.hasOwn(value,field)))fail('invalid '+label);
}
function ident(value,label){
  if(typeof value!=='string'||!IDENT.test(value))fail('invalid '+label);
  return value;
}
function gridIds(grid){
  const result=[];
  for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.columns;col++){
    if(row!==0||col!==0)result.push(`${grid.idPrefix}:r${row}c${col}`);
  }
  return result;
}
function validateGridShape(grid,mode){
  exact(grid,mode==='resize'?['sourceHoleId','idPrefix','columns','rows','scaleX','scaleY','radiusScale']:
    mode==='reshape'?['sourceHoleId','idPrefix','columns','rows','pitchXmm','pitchYmm','nextColumns','nextRows']:
    ['sourceHoleId','idPrefix','columns','rows','pitchXmm','pitchYmm'],'grid');
  ident(grid.sourceHoleId,'sourceHoleId');
  if(typeof grid.idPrefix!=='string'||!PREFIX.test(grid.idPrefix)||
      !Number.isSafeInteger(grid.columns)||grid.columns<1||grid.columns>8||
      !Number.isSafeInteger(grid.rows)||grid.rows<1||grid.rows>8||
      grid.columns*grid.rows<2||grid.columns*grid.rows>32)
    fail('grid must have 2–32 cells, at most 8 per axis and a stable prefix');
  if(mode==='create'||mode==='reshape'){
    if(!finite(grid.pitchXmm)||!finite(grid.pitchYmm)||
        (grid.columns>1&&grid.pitchXmm===0)||
        (grid.rows>1&&grid.pitchYmm===0))
      fail('invalid active grid pitches');
  }else if(![grid.scaleX,grid.scaleY,grid.radiusScale].every(x=>finite(x)&&x>0)||
      (grid.scaleX===1&&grid.scaleY===1&&grid.radiusScale===1)){
    fail('positive resize factors with an actual change required');
  }
  if(mode==='reshape'){
    if(!Number.isSafeInteger(grid.nextColumns)||grid.nextColumns<1||grid.nextColumns>8||
       !Number.isSafeInteger(grid.nextRows)||grid.nextRows<1||grid.nextRows>8||
       grid.nextColumns*grid.nextRows<2||grid.nextColumns*grid.nextRows>32||
       (grid.nextColumns===grid.columns&&grid.nextRows===grid.rows)||
       (grid.nextColumns>1&&grid.pitchXmm===0)||
       (grid.nextRows>1&&grid.pitchYmm===0))
      fail('next grid must have 2–32 cells and different bounded row/column counts');
  }
  const ids=gridIds(grid);
  if(ids.some(id=>!IDENT.test(id)||[id+':center',id+':fixed',id+':diameter']
      .some(derived=>derived.length>111)))fail('generated identity exceeds runtime limits');
  return ids;
}
const reportState=(report,id)=>report.features?.find(entry=>entry.featureId===id);
function context(history,request,services,kind){
  exact(request,['format','version','eventId','expectedProjectId','expectedRevision',
    'units','frame','sketchFeatureId','extrudeFeatureId','cutFeatureId',
    'targetBodyId','grid'],'request');
  if(request.format!==RECTANGULAR_HOLE_GRID_FORMAT||
      request.version!==RECTANGULAR_HOLE_GRID_VERSION||
      request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported protocol, units or frame');
  if(!history?.document||request.expectedProjectId!==history.document.projectId||
      !Number.isSafeInteger(request.expectedRevision)||
      history.document.revision!==request.expectedRevision)
    throw new Error('feature-ops grid: stale project/revision');
  const eventId=ident(request.eventId,'eventId');
  const sketchId=ident(request.sketchFeatureId,'sketchFeatureId');
  const extrudeId=ident(request.extrudeFeatureId,'extrudeFeatureId');
  const cutId=ident(request.cutFeatureId,'cutFeatureId');
  const bodyId=ident(request.targetBodyId,'targetBodyId');
  if(new Set([sketchId,extrudeId,cutId,bodyId]).size!==4)
    fail('aliased sketch, extrusion, cut or body identity');
  const ids=validateGridShape(request.grid,kind);
  const {model,runtime}=services??{};
  if(typeof model?.featuresOf!=='function'||typeof runtime?.inspect!=='function'||
      typeof runtime?.[kind==='create'?'patternPlateHoles':
        kind==='resize'?'resizePlateHoleLayout':'editPlateHoles']!=='function')
    fail('accepted INTENT and RUNTIME services required');
  const features=model.featuresOf(history.document);
  const sketch=features.find(f=>f.id===sketchId);
  const extrusion=features.find(f=>f.id===extrudeId);
  const cut=features.find(f=>f.id===cutId);
  if(sketch?.kind!=='sketch'||!sketch.payload?.sketch||
      !Array.isArray(sketch.writeTargets)||sketch.writeTargets.length!==0||
      extrusion?.kind!=='extrude'||extrusion.payload?.sourceSketchId!==sketchId||
      extrusion.writeTargets?.length!==1||extrusion.writeTargets[0]!==bodyId||
      !extrusion.dependsOn?.includes(sketchId)||
      cut?.kind!=='cut'||cut.payload?.targetBodyId!==bodyId||
      cut.payload?.sourceSketchId!==sketchId||
      cut.writeTargets?.length!==1||cut.writeTargets[0]!==bodyId||
      !cut.dependsOn?.includes(extrudeId)||
      features.some(f=>![extrudeId,cutId].includes(f.id)&&f.writeTargets?.includes(bodyId)))
    fail('selected sketch, extrusion, cut or body lineage ambiguous');
  const doc=sketch.payload.sketch;
  if(!Array.isArray(doc.circles)||!doc.circles.some(c=>c.id===request.grid.sourceHoleId))
    fail('selected source circle missing');
  const owned=new Set([...doc.points??[],...doc.lines??[],...doc.circles,
    ...doc.constraints??[]].map(e=>e.id));
  if(kind==='create'){
    if(doc.circles.length+ids.length>64)fail('SKETCH hole capacity exceeded');
    if(ids.some(id=>[id,id+':center',id+':fixed',id+':diameter'].some(x=>owned.has(x))))
      fail('copy or derived entity identity already occupied');
  }else {
    if(ids.some(id=>!doc.circles.some(c=>c.id===id)))
      fail('named grid copy missing; never infer or silently recreate it');
  }
  const before=runtime.inspect(history);
  if(before.projectId!==request.expectedProjectId||
      before.revision!==request.expectedRevision||
      reportState(before,sketchId)?.status!=='analytic_profile_only'||
      reportState(before,extrudeId)?.status!=='preview_only'||
      reportState(before,cutId)?.status!=='pending_exact_provider')
    fail('selected source requires admitted current sketch, extrusion and cut');
  return {eventId,sketchId,extrudeId,cutId,bodyId,doc,ids,runtime,model};
}
function finish(result,history,request,ctx,mode){
  if(result?.kind==='refused')return {...result,gridHoleIds:ctx.ids,
    exactAuthority:false,independentInteroperability:false};
  if(result?.kind!=='committed'||!result.history?.document||
      result.history.document.projectId!==request.expectedProjectId||
      result.history.document.revision!==request.expectedRevision+1||
      result.report?.projectId!==request.expectedProjectId||
      result.report?.revision!==result.history.document.revision||
      reportState(result.report,ctx.sketchId)?.status!=='analytic_profile_only'||
      reportState(result.report,ctx.cutId)?.status!=='pending_exact_provider')
    throw new Error('feature-ops grid: RUNTIME did not retain admitted pending intent');
  const features=ctx.model.featuresOf(result.history.document);
  const next=features.find(f=>f.id===ctx.sketchId)?.payload?.sketch;
  const afterIds=next?.circles?.map(c=>c.id);
  if(!afterIds||new Set(afterIds).size!==afterIds.length||
      !afterIds.includes(request.grid.sourceHoleId)||
      !ctx.ids.every(id=>afterIds.includes(id))||
      afterIds.length!==ctx.doc.circles.length+(mode==='create'?ctx.ids.length:0)||
      ![ctx.sketchId,ctx.extrudeId,ctx.cutId].every(id=>
        result.invalidation?.invalidatedFeatureIds?.includes(id)))
    throw new Error('feature-ops grid: semantic identities or invalidation lost');
  return {kind:'committed',history:result.history,report:result.report,
    invalidation:result.invalidation,gridHoleIds:ctx.ids,
    semanticIds:{sketchId:ctx.sketchId,extrudeId:ctx.extrudeId,
      cutId:ctx.cutId,bodyId:ctx.bodyId},
    status:'pending_exact_provider',
    nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:ctx.cutId,
      bodyId:ctx.bodyId,sourceRevision:result.history.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
/** Author an axis-aligned rectangular 2D array from a selected solved circle.
 * The original remains r0c0; every other cell becomes an independent hole. */
export function authorRectangularHoleGrid(history,request,services){
  const ctx=context(history,request,services,'create');
  const result=ctx.runtime.patternPlateHoles(history,{
    sketchFeatureId:ctx.sketchId,eventId:ctx.eventId,
    expectedRevision:request.expectedRevision,admission:'require_admissible',
    sourceHoleId:request.grid.sourceHoleId,idPrefix:request.grid.idPrefix,
    columns:request.grid.columns,rows:request.grid.rows,
    pitchXmm:request.grid.pitchXmm,pitchYmm:request.grid.pitchYmm
  });
  return finish(result,history,request,ctx,'create');
}
/** Retrospectively rescale explicitly named independent grid holes around the
 * current SOLVED source circle, preserving all hole IDs and other sketch parts.
 * Not a persistent array constraint: an edited/deleted copy is NOT recreated. */
export function resizeRectangularHoleGrid(history,request,services){
  const ctx=context(history,request,services,'resize');
  if(typeof services?.sketch?.validateSketch!=='function'||
      typeof services?.sketch?.solveSketch!=='function')
    fail('accepted SKETCH validation and solver required for resize pivot');
  const verified=services.sketch.validateSketch(ctx.doc);
  const solution=services.sketch.solveSketch(verified);
  const source=verified.circles.find(c=>c.id===request.grid.sourceHoleId);
  const center=solution?.geometry?.points?.find(p=>p.id===source?.center);
  if(solution?.status!=='solved'||!center||![center.x,center.y].every(finite))
    fail('source circle lacks current solved pivot');
  const result=ctx.runtime.resizePlateHoleLayout(history,{
    sketchFeatureId:ctx.sketchId,eventId:ctx.eventId,
    expectedRevision:request.expectedRevision,admission:'require_admissible',
    holeIds:ctx.ids,pivotXmm:center.x,pivotYmm:center.y,
    scaleX:request.grid.scaleX,scaleY:request.grid.scaleY,
    radiusScale:request.grid.radiusScale
  });
  return finish(result,history,request,ctx,'resize');
}


/**
 * Change the row/column COUNT of an admitted, regular rectangular hole grid.
 * Unlike deleting/rebuilding the sketch, retained cells keep their semantic
 * circle/point/constraint identities. Growth and shrinkage are one undoable
 * RUNTIME editPlateHoles() transaction. Existing cells must STILL match the
 * caller's original signed pitch and source; displaced copies fail closed.
 *
 * This is not an associative pattern feature. The selected solved SKETCH is
 * the coordinate authority; actual profile/overlap admission belongs solely
 * to SKETCH/RUNTIME, and physical Boolean execution remains pending.
 */
export function reshapeRectangularHoleGrid(history,request,services){
  const ctx=context(history,request,services,'reshape');
  const grid=request.grid;
  if(typeof services?.sketch?.validateSketch!=='function'||
     typeof services?.sketch?.solveSketch!=='function')
    fail('accepted SKETCH solver required for grid reconfiguration');
  const checked=services.sketch.validateSketch(ctx.doc);
  const solution=services.sketch.solveSketch(checked);
  const source=checked.circles?.find(c=>c.id===grid.sourceHoleId);
  const origin=solution?.geometry?.points?.find(p=>p.id===source?.center);
  const solvedSource=solution?.geometry?.circles?.find(c=>c.id===grid.sourceHoleId);
  if(solution?.status!=='solved'||!origin||!solvedSource||
     ![origin.x,origin.y,solvedSource.radius].every(finite)||
     solvedSource.radius<=0)
    fail('source circle has no admissible solved centre/radius');

  // A semantic provenance check (1e-6 mm), never a Boolean or export
  // tolerance. Missing/independently moved cells cannot be silently rebuilt.
  const tolerance=1e-6;
  for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.columns;col++){
    const holeId=row===0&&col===0?grid.sourceHoleId:
      grid.idPrefix+':r'+row+'c'+col;
    const circle=checked.circles.find(c=>c.id===holeId);
    const point=solution.geometry.points?.find(p=>p.id===circle?.center);
    const solvedCircle=solution.geometry.circles?.find(c=>c.id===holeId);
    const expectedX=origin.x+col*grid.pitchXmm;
    const expectedY=origin.y+row*grid.pitchYmm;
    if(!circle||!point||!solvedCircle||
       ![point.x,point.y,solvedCircle.radius,expectedX,expectedY].every(finite)||
       solvedCircle.radius<=0||
       Math.abs(solvedCircle.radius-solvedSource.radius)>tolerance||
       Math.abs(point.x-expectedX)>tolerance||
       Math.abs(point.y-expectedY)>tolerance)
      fail('existing grid layout does not match selected solved provenance');
  }
  const nextIds=gridIds({idPrefix:grid.idPrefix,
    columns:grid.nextColumns,rows:grid.nextRows});
  const before=new Set(ctx.ids),after=new Set(nextIds);
  const removed=ctx.ids.filter(holeId=>!after.has(holeId));
  const retained=ctx.ids.filter(holeId=>after.has(holeId));
  const added=nextIds.filter(holeId=>!before.has(holeId));
  const occupied=new Set([...checked.points,...checked.lines,...checked.circles,
    ...checked.constraints].map(entity=>entity.id));
  for(const holeId of added){
    if(!IDENT.test(holeId)||
      [holeId,holeId+':center',holeId+':fixed',holeId+':diameter']
        .some(entityId=>occupied.has(entityId)))
      fail('new grid cell or dependent entity ID already occupied');
  }
  if(checked.circles.length-removed.length+added.length>64)
    fail('SKETCH hole capacity exceeded');
  const operations=removed.map(id=>({kind:'remove',id}));
  for(let row=0;row<grid.nextRows;row++)for(let col=0;col<grid.nextColumns;col++){
    if(row===0&&col===0)continue;
    const holeId=grid.idPrefix+':r'+row+'c'+col;
    if(!before.has(holeId)){
      const x=origin.x+col*grid.pitchXmm,y=origin.y+row*grid.pitchYmm;
      if(!finite(x)||!finite(y))fail('new grid coordinates are non-finite');
      operations.push({kind:'add',id:holeId,x,y,radius:solvedSource.radius});
    }
  }
  if(operations.length<1||operations.length>32)
    fail('grid reconfiguration exceeds atomic RUNTIME hole edit batch');
  const result=ctx.runtime.editPlateHoles(history,{
    sketchFeatureId:ctx.sketchId,eventId:ctx.eventId,
    expectedRevision:request.expectedRevision,admission:'require_admissible',
    operations
  });
  const changes={added,removed,retained};
  if(result?.kind==='refused')
    return {...result,changes,gridHoleIds:nextIds,
      exactAuthority:false,independentInteroperability:false};
  if(result?.kind!=='committed'||!result.history?.document||
     result.history.document.projectId!==request.expectedProjectId||
     result.history.document.revision!==request.expectedRevision+1||
     result.report?.projectId!==request.expectedProjectId||
     result.report?.revision!==result.history.document.revision||
     reportState(result.report,ctx.sketchId)?.status!=='analytic_profile_only'||
     reportState(result.report,ctx.cutId)?.status!=='pending_exact_provider')
    throw new Error('feature-ops grid: runtime did not retain admitted count edit');
  const next=ctx.model.featuresOf(result.history.document)
    .find(feature=>feature.id===ctx.sketchId)?.payload?.sketch;
  const actualIds=next?.circles?.map(circle=>circle.id);
  const oldOtherIds=ctx.doc.circles.map(circle=>circle.id)
    .filter(id=>id!==grid.sourceHoleId&&!before.has(id));
  if(!actualIds||new Set(actualIds).size!==actualIds.length||
     actualIds.length!==ctx.doc.circles.length-removed.length+added.length||
     !actualIds.includes(grid.sourceHoleId)||
     !nextIds.every(id=>actualIds.includes(id))||
     !oldOtherIds.every(id=>actualIds.includes(id))||
     !removed.every(id=>!actualIds.includes(id))||
     ![ctx.sketchId,ctx.extrudeId,ctx.cutId].every(id=>
       result.invalidation?.invalidatedFeatureIds?.includes(id)))
    throw new Error('feature-ops grid: reconfiguration lost semantic identities or invalidation');
  return {kind:'committed',history:result.history,report:result.report,
    invalidation:result.invalidation,changes,gridHoleIds:nextIds,
    semanticIds:{sketchId:ctx.sketchId,extrudeId:ctx.extrudeId,
      cutId:ctx.cutId,bodyId:ctx.bodyId},
    status:'pending_exact_provider',
    nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:ctx.cutId,
      bodyId:ctx.bodyId,sourceRevision:result.history.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
