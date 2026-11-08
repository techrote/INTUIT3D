/**
 * One consumer drag relocates an ordered 2-16 cut machining block together.
 * Accepted INTENT owns topology/admission, RUNTIME owns evaluation/rebuild.
 * This adapter provides strict public UI selection and one durable undo frame.
 * It never promises an executed Boolean or native STEP.
 */
export const CUT_BLOCK_PLACEMENT_FORMAT='intuit3d.feature-ops.cut-block-placement';
export const CUT_BLOCK_PLACEMENT_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const own=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x))&&
  Object.keys(x).length===fields.length&&fields.every(f=>Object.hasOwn(x,f));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function fail(message){throw new TypeError('feature-ops cut block placement: '+message);}
const common=['format','version','expectedProjectId','expectedRevision',
  'expectedDocumentFence','units','frame','targetBodyId','cutFeatureIds'];
const inspectorFields=[...common,'offset','limit'];
const moveFields=[...common,'afterBodyWriterId','expectedWriterOrder',
  'expectedCutSelections','eventIds'];
function servicesOf(services){
  const {model,runtime,block}=services??{};
  if(typeof model?.featuresOf!=='function'||
     typeof model?.serializeProject!=='function'||
     typeof runtime?.inspect!=='function'||typeof runtime?.diff!=='function'||
     typeof block?.inspectBodyCutBlockDestinations!=='function'||
     typeof block?.previewBodyCutBlockRelocate!=='function'||
     typeof block?.commitUndoableBodyCutBlockRelocate!=='function')
    fail('accepted INTENT block, model and RUNTIME services required');
  return {model,runtime,block};
}
function selection(history,request,fields,s){
  if(!own(request,fields)||request.format!==CUT_BLOCK_PLACEMENT_FORMAT||
     request.version!==1||request.units!=='mm'||request.frame!=='local_xy'||
     !ID.test(request.expectedProjectId??'')||
     !ID.test(request.targetBodyId??'')||
     !Number.isSafeInteger(request.expectedRevision)||
     !Array.isArray(request.cutFeatureIds)||
     request.cutFeatureIds.length<2||request.cutFeatureIds.length>16||
     !request.cutFeatureIds.every(x=>typeof x==='string'&&ID.test(x))||
     new Set(request.cutFeatureIds).size!==request.cutFeatureIds.length||
     typeof request.expectedDocumentFence!=='string')
    fail('invalid versioned selection, frame, units or semantic IDs');
  const doc=history?.document;
  if(!doc||doc.projectId!==request.expectedProjectId||
     doc.revision!==request.expectedRevision||
     s.model.serializeProject(doc)!==request.expectedDocumentFence)
    fail('stale project, revision or canonical document fence');
  return {format:'intuit3d.body-cut-block-relocate',version:1,
    expectedProjectId:request.expectedProjectId,
    expectedRevision:request.expectedRevision,
    expectedDocumentFence:request.expectedDocumentFence,
    targetBodyId:request.targetBodyId,cutFeatureIds:request.cutFeatureIds};
}
function cutsOf(doc,ids,model){
  const byId=new Map(model.featuresOf(doc).map(f=>[f.id,f]));
  return ids.map(cutFeatureId=>{
    const f=byId.get(cutFeatureId);
    if(f?.kind!=='cut'||f.writeTargets?.length!==1||
       f.payload?.targetBodyId!==f.writeTargets[0])
      fail('selected operation is not a uniquely body-targeted cut: '+cutFeatureId);
    const p=f.payload;
    if(p.units!=='mm'||p.frame!=='local_xy'||
       typeof p.sourceSketchId!=='string'||
       typeof p.profileCandidateId!=='string'||
       !p.profileCandidateId.startsWith('cycle:'))
      fail('selected cut has no admitted mm/local_xy SKETCH source: '+cutFeatureId);
    const src=byId.get(p.sourceSketchId);
    if(src?.kind!=='sketch')fail('selected cut source SKETCH is absent');
    const extent=p.throughAll===true&&!Object.hasOwn(p,'depthMm')
      ?{kind:'through_all'}
      :p.throughAll===false&&Number.isFinite(p.depthMm)&&p.depthMm>0
        ?{kind:'blind',depthMm:p.depthMm}:null;
    if(!extent)fail('selected cut has ambiguous blind/through extent');
    return {cutFeatureId,sourceSketchId:p.sourceSketchId,
      profileCandidateId:p.profileCandidateId,extent};
  });
}
function inspection(history,request,services,offset,limit){
  const s=servicesOf(services);
  const selected=selection(history,request,offset===null?moveFields:inspectorFields,s);
  const candidates=s.block.inspectBodyCutBlockDestinations(history.document,{
    ...selected,offset:offset??0,limit:limit??16});
  const selectedCuts=cutsOf(history.document,request.cutFeatureIds,s.model);
  return {s,selected,candidates,selectedCuts};
}
/** Paginated available/blocked/current drop anchors, with stable semantic IDs. */
export function inspectCutBlockPlacement(history,request,services){
  const {candidates,selectedCuts}=inspection(history,request,services,
    request?.offset,request?.limit);
  return {
    format:CUT_BLOCK_PLACEMENT_FORMAT,version:1,kind:'placement_inventory',
    projectId:candidates.projectId,revision:candidates.revision,
    documentFence:request.expectedDocumentFence,
    units:'mm',frame:'local_xy',targetBodyId:candidates.targetBodyId,
    cutFeatureIds:[...request.cutFeatureIds],cutSelections:selectedCuts,
    writerOrder:candidates.writerOrderBefore,
    destinations:candidates.destinations,totalDestinations:candidates.totalDestinations,
    offset:candidates.offset,limit:candidates.limit,nextOffset:candidates.nextOffset,
    exactAuthority:false,independentInteroperability:false};
}
/**
 * Commit selected machining block as ONE undo operation, preserving each cut's
 * source, extent, semantic identity and internal order. INTENT independently
 * validates the exact candidate and required event count, including dependent
 * selected edges on another body. No inferred drop anchor or topology repair.
 */
export function moveCutBlock(history,request,services){
  const {s,selected,candidates,selectedCuts}=inspection(
    history,request,services,null,null);
  if(!Array.isArray(request.expectedWriterOrder)||
     !same(request.expectedWriterOrder,candidates.writerOrderBefore)||
     !same(request.expectedCutSelections,selectedCuts))
    fail('cut selection or writer order changed since inspection');
  if(typeof request.afterBodyWriterId!=='string'||
     !ID.test(request.afterBodyWriterId)||
     !Array.isArray(request.eventIds)||request.eventIds.length<2||
     request.eventIds.length>3||
     !request.eventIds.every(x=>typeof x==='string'&&ID.test(x))||
     new Set(request.eventIds).size!==request.eventIds.length)
    fail('invalid destination or event IDs');
  const planned=s.block.previewBodyCutBlockRelocate(history.document,{
    ...selected,afterBodyWriterId:request.afterBodyWriterId,
    eventIds:request.eventIds});
  if(planned.exactGeometryAuthority!==false||
     planned.requiresNativeRebuild!==true||
     planned.authoredTimelineChanged!==false||
     planned.events.length!==request.eventIds.length||
     !same(planned.events.map(e=>e.eventId),request.eventIds)||
     !same(planned.writerOrderBefore,request.expectedWriterOrder)||
     !same(planned.cutFeatureIds,request.cutFeatureIds))
    fail('INTENT preview does not match selected move');
  const next=s.block.commitUndoableBodyCutBlockRelocate(history,{
    ...selected,afterBodyWriterId:request.afterBodyWriterId,eventIds:request.eventIds});
  if(next.undoStack.length!==history.undoStack.length+1||
     next.document.revision!==history.document.revision+request.eventIds.length||
     s.model.serializeProject(next.document)!==
       s.model.serializeProject(planned.document)||
     !same(cutsOf(next.document,request.cutFeatureIds,s.model),selectedCuts))
    fail('INTENT commit differs from the approved atomic move');
  const invalidation=s.runtime.diff(history,next);
  if(!planned.rewiredWriterIds.every(fid=>
      invalidation.invalidatedFeatureIds.includes(fid)))
    fail('RUNTIME invalidation missed rewired dependency');
  const report=s.runtime.inspect(next);
  const statuses=planned.writerOrderAfter.slice(1).map(cutFeatureId=>({
    cutFeatureId,
    status:report.features.find(row=>row.featureId===cutFeatureId)?.status??'unavailable',
  }));
  return {kind:'committed',history:next,report,invalidation,
    writerOrderBefore:planned.writerOrderBefore,
    writerOrderAfter:planned.writerOrderAfter,
    movedCutIds:planned.cutFeatureIds,
    rewiredWriterIds:planned.rewiredWriterIds,
    invalidatedBodyIds:planned.invalidatedBodyIds,
    eventIds:[...request.eventIds],statuses,
    authoredTimelineChanged:false,
    nativeHandoff:{
      kind:'runtime_evaluation_required',bodyId:request.targetBodyId,
      sourceRevision:next.document.revision,
      orderedWriterIds:planned.writerOrderAfter,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
