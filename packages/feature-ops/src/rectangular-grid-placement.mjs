/**
 * FEATUREOPS rectangular-grid-placement/v1.
 *
 * Atomically rotates/translates an EXISTING complete rectangular array of
 * independent, named holes through RUNTIME's admitted rigid-hole transform.
 * Proves source provenance from real solved SKETCH geometry first, including
 * after previous rigid edits. No rival solver/journal or physical Boolean.
 */
export const GRID_PLACEMENT_FORMAT='intuit3d.feature-ops.rectangular-grid-placement';
export const GRID_PLACEMENT_VERSION=1;

const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,100}$/;
const PREFIX=/^[A-Za-z][A-Za-z0-9._:-]{0,89}$/;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const fail=message=>{throw new TypeError('feature-ops grid placement: '+message);};
function shape(o,fields,label){
 if(!plain(o)||Object.keys(o).length!==fields.length||
    fields.some(f=>!Object.hasOwn(o,f)))fail('invalid '+label);
}
function id(value,label){
 if(typeof value!=='string'||!IDENT.test(value))fail('invalid '+label);
 return value;
}
function state(report,featureId){
 return report?.features?.find(f=>f.featureId===featureId)?.status;
}
function solvedCircles(doc,sketch,holeIds){
 const verified=sketch.validateSketch(doc);
 const result=sketch.solveSketch(verified);
 if(result?.status!=='solved'||!result.geometry)
   fail('current solved SKETCH geometry required');
 return holeIds.map(holeId=>{
  const circle=verified.circles?.find(c=>c.id===holeId);
  const point=result.geometry.points?.find(p=>p.id===circle?.center);
  const radius=result.geometry.circles?.find(c=>c.id===holeId)?.radius;
  if(!circle||!point||![point.x,point.y,radius].every(finite)||radius<=0)
   fail('named hole lacks solved position or radius');
  return {id:holeId,x:point.x,y:point.y,radius};
 });
}
const EPS_MM=1e-6; // solved-pattern provenance check, NOT a geometry/Boolean tolerance

/** One transaction for all holes, including source/r0c0. */
export function placeRectangularHoleGrid(history,request,services){
 shape(request,['format','version','eventId','expectedProjectId','expectedRevision',
  'units','frame','sketchFeatureId','extrudeFeatureId','cutFeatureId',
  'targetBodyId','placement'],'request');
 if(request.format!==GRID_PLACEMENT_FORMAT||request.version!==GRID_PLACEMENT_VERSION||
    request.units!=='mm'||request.frame!=='local_xy')
   fail('unsupported protocol, units or frame');
 if(!history?.document||request.expectedProjectId!==history.document.projectId||
    !Number.isSafeInteger(request.expectedRevision)||
    request.expectedRevision!==history.document.revision)
   throw new Error('feature-ops grid placement: stale project/revision');
 const eventId=id(request.eventId,'eventId');
 const sketchId=id(request.sketchFeatureId,'sketchFeatureId');
 const extrudeId=id(request.extrudeFeatureId,'extrudeFeatureId');
 const cutId=id(request.cutFeatureId,'cutFeatureId');
 const bodyId=id(request.targetBodyId,'targetBodyId');
 if(new Set([sketchId,extrudeId,cutId,bodyId]).size!==4)
   fail('aliased sketch, extrusion, cut or target body');
 const g=request.placement;
 shape(g,['sourceHoleId','idPrefix','columns','rows','stepX','stepY',
  'pivotXmm','pivotYmm','rotateDegrees','translateXmm','translateYmm'],'placement');
 id(g.sourceHoleId,'sourceHoleId');
 if(typeof g.idPrefix!=='string'||!PREFIX.test(g.idPrefix)||
    !Number.isSafeInteger(g.columns)||g.columns<1||g.columns>8||
    !Number.isSafeInteger(g.rows)||g.rows<1||g.rows>8||
    g.columns*g.rows<2||g.columns*g.rows>32)
   fail('2–32 cells, 8 maximum per axis and stable grid prefix required');
 shape(g.stepX,['dxMm','dyMm'],'stepX');
 shape(g.stepY,['dxMm','dyMm'],'stepY');
 const x=g.stepX,y=g.stepY;
 if(![x.dxMm,x.dyMm,y.dxMm,y.dyMm,g.pivotXmm,g.pivotYmm,
      g.rotateDegrees,g.translateXmm,g.translateYmm].every(finite)||
    Math.abs(g.rotateDegrees)>=360||
    (g.rotateDegrees===0&&g.translateXmm===0&&g.translateYmm===0))
   fail('finite grid vectors and nonzero rigid transform required');
 const nx=Math.hypot(x.dxMm,x.dyMm),ny=Math.hypot(y.dxMm,y.dyMm);
 if(!finite(nx)||!finite(ny)||
    (g.columns>1&&nx===0)||(g.rows>1&&ny===0)||
    (g.columns>1&&g.rows>1&&Math.abs(x.dxMm*y.dxMm+x.dyMm*y.dyMm)>
      1e-8*nx*ny))
   fail('active rectangular grid axes must be nonzero and perpendicular');
 const holeIds=[g.sourceHoleId];
 for(let row=0;row<g.rows;row++)for(let col=0;col<g.columns;col++){
  if(row!==0||col!==0)holeIds.push(g.idPrefix+':r'+row+'c'+col);
 }
 if(new Set(holeIds).size!==holeIds.length||holeIds.some(name=>!IDENT.test(name)))
   fail('duplicate or oversized hole identities');
 const {model,runtime,sketch}=services??{};
 if(typeof model?.featuresOf!=='function'||typeof runtime?.inspect!=='function'||
    typeof runtime?.transformPlateHoles!=='function'||
    typeof sketch?.validateSketch!=='function'||typeof sketch?.solveSketch!=='function')
   fail('authoritative INTENT, RUNTIME and SKETCH required');
 const features=model.featuresOf(history.document);
 const source=features.find(f=>f.id===sketchId);
 const extrusion=features.find(f=>f.id===extrudeId);
 const cut=features.find(f=>f.id===cutId);
 if(source?.kind!=='sketch'||!source.payload?.sketch||
    !Array.isArray(source.writeTargets)||source.writeTargets.length!==0||
    extrusion?.kind!=='extrude'||extrusion.payload?.sourceSketchId!==sketchId||
    extrusion.writeTargets?.length!==1||extrusion.writeTargets[0]!==bodyId||
    !extrusion.dependsOn?.includes(sketchId)||
    cut?.kind!=='cut'||cut.payload?.sourceSketchId!==sketchId||
    cut.payload?.targetBodyId!==bodyId||
    cut.writeTargets?.length!==1||cut.writeTargets[0]!==bodyId||
    !cut.dependsOn?.includes(extrudeId)||
    features.some(f=>![extrudeId,cutId].includes(f.id)&&f.writeTargets?.includes(bodyId)))
   fail('ambiguous sketch/extrusion/cut/body provenance');
 const doc=source.payload.sketch;
 if(!Array.isArray(doc.circles)||!holeIds.every(name=>
     doc.circles.some(c=>c.id===name)))
   fail('named grid cell missing; no inferred identity repair');
 const before=runtime.inspect(history);
 if(before.projectId!==request.expectedProjectId||
    before.revision!==request.expectedRevision||
    state(before,sketchId)!=='analytic_profile_only'||
    state(before,extrudeId)!=='preview_only'||
    state(before,cutId)!=='pending_exact_provider')
   fail('selected features lack current admitted intent');
 const original=solvedCircles(doc,sketch,holeIds);
 const radius=original[0].radius;
 for(let row=0,i=0;row<g.rows;row++)for(let col=0;col<g.columns;col++,i++){
  const expectedX=original[0].x+col*x.dxMm+row*y.dxMm;
  const expectedY=original[0].y+col*x.dyMm+row*y.dyMm;
  if(!finite(expectedX)||!finite(expectedY)||
     Math.hypot(original[i].x-expectedX,original[i].y-expectedY)>EPS_MM||
     Math.abs(original[i].radius-radius)>EPS_MM)
   fail('named cells differ from actual solved rectangular-grid provenance');
 }
 const angle=g.rotateDegrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const expected=original.map(p=>{
  const dx=p.x-g.pivotXmm,dy=p.y-g.pivotYmm;
  return {id:p.id,x:g.pivotXmm+c*dx-s*dy+g.translateXmm,
   y:g.pivotYmm+s*dx+c*dy+g.translateYmm,radius:p.radius};
 });
 if(expected.some(p=>![p.x,p.y].every(finite)))
   fail('transformed hole coordinates overflow');
 const result=runtime.transformPlateHoles(history,{
  sketchFeatureId:sketchId,eventId,expectedRevision:request.expectedRevision,
  admission:'require_admissible',holeIds,rotateDegrees:g.rotateDegrees,
  translateXmm:g.translateXmm,translateYmm:g.translateYmm,
  pivotXmm:g.pivotXmm,pivotYmm:g.pivotYmm
 });
 if(result?.kind==='refused')return {...result,holeIds,
   exactAuthority:false,independentInteroperability:false};
 if(result?.kind!=='committed'||!result.history?.document||
    result.history.document.projectId!==request.expectedProjectId||
    result.history.document.revision!==request.expectedRevision+1||
    result.report?.projectId!==request.expectedProjectId||
    result.report?.revision!==result.history.document.revision||
    state(result.report,sketchId)!=='analytic_profile_only'||
    state(result.report,cutId)!=='pending_exact_provider')
   throw new Error('feature-ops grid placement: RUNTIME did not retain admitted intent');
 const next=model.featuresOf(result.history.document)
  .find(f=>f.id===sketchId)?.payload?.sketch;
 const nextIds=next?.circles?.map(c=>c.id);
 if(!nextIds||nextIds.length!==doc.circles.length||
    new Set(nextIds).size!==nextIds.length||
    !holeIds.every(name=>nextIds.includes(name))||
    ![sketchId,extrudeId,cutId].every(name=>
      result.invalidation?.invalidatedFeatureIds?.includes(name)))
   throw new Error('feature-ops grid placement: IDs or downstream invalidation lost');
 const actual=solvedCircles(next,sketch,holeIds);
 for(let i=0;i<actual.length;i++){
  if(Math.hypot(actual[i].x-expected[i].x,actual[i].y-expected[i].y)>EPS_MM||
     Math.abs(actual[i].radius-expected[i].radius)>EPS_MM)
   throw new Error('feature-ops grid placement: actual solved rigid edit differs');
 }
 return {kind:'committed',history:result.history,report:result.report,
  invalidation:result.invalidation,holeIds,
  semanticIds:{sketchId,extrudeId,cutId,bodyId},
  placement:{pivotXmm:g.pivotXmm+g.translateXmm,
    pivotYmm:g.pivotYmm+g.translateYmm,rotateDegrees:g.rotateDegrees},
  status:'pending_exact_provider',
  nativeHandoff:{kind:'runtime_evaluation_required',cutFeatureId:cutId,
    bodyId,sourceRevision:result.history.document.revision,
    compatibility:'not_claimed_ask_RUNTIME_provider',
    exactAuthority:false,independentInteroperability:false},
  exactAuthority:false,independentInteroperability:false};
}
