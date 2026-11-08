/**
 * Author two to eight existing machined-body base replacements as one
 * MODEL journal transaction, keeping named cuts and their cut-chain order.
 * All admission is delegated to accepted extrusion-reconfiguration/v1.
 */
import {EXTRUSION_RECONFIG_FORMAT,reconfigureProfileExtrusion}
  from './extrusion-reconfiguration.mjs';

export const FAMILY_BASE_FORMAT='intuit3d.feature-ops.machined-family-base';
export const FAMILY_BASE_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function fail(reason){throw new TypeError('machined-family-base: '+reason);}
function exact(x,keys,label){
  if(!plain(x)||Object.keys(x).length!==keys.length||
     keys.some(k=>!Object.hasOwn(x,k))||
     Object.keys(x).some(k=>!keys.includes(k)))fail('invalid '+label);
}
function id(x,label){if(typeof x!=='string'||!ID.test(x))fail('invalid '+label);return x;}
function initial(history,request,services){
  exact(request,['format','version','expectedProjectId','expectedRevision',
    'expectedDocumentFence','units','frame','edits'],'request');
  if(request.format!==FAMILY_BASE_FORMAT||request.version!==FAMILY_BASE_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported version, units or frame');
  const {model,runtime}=services??{};
  if(typeof model?.featuresOf!=='function'||
     typeof model?.serializeProject!=='function'||
     typeof runtime?.commit!=='function'||
     typeof runtime?.inspect!=='function'||
     typeof runtime?.diff!=='function')
    fail('accepted MODEL and RUNTIME services required');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     history.document.projectId!==request.expectedProjectId||
     history.document.revision!==request.expectedRevision||
     model.serializeProject(history.document)!==request.expectedDocumentFence)
    fail('stale project, revision or canonical source archive');
  if(!Array.isArray(request.edits)||request.edits.length<2||
     request.edits.length>8)fail('select 2–8 existing machined bodies');
  const bodies=new Set(),extrusions=new Set(),eventIds=new Set();
  for(const edit of request.edits){
    exact(edit,['eventId','extrudeFeatureId','outputBodyId','from','to'],'body edit');
    exact(edit.from,['sourceSketchId','depthMm'],'previous base');
    exact(edit.to,['sourceSketchId','profileCandidateId','depthMm'],'replacement base');
    for(const [key,value] of [['eventId',edit.eventId],
      ['extrudeFeatureId',edit.extrudeFeatureId],
      ['outputBodyId',edit.outputBodyId],
      ['from.sourceSketchId',edit.from.sourceSketchId],
      ['to.sourceSketchId',edit.to.sourceSketchId]])
      id(value,key);
    if(typeof edit.to.profileCandidateId!=='string'||
       !edit.to.profileCandidateId.startsWith('cycle:')||
       edit.to.profileCandidateId.length>8192)
      fail('explicit solved target SKETCH cycle required');
    for(const mm of [edit.from.depthMm,edit.to.depthMm])
      if(typeof mm!=='number'||!Number.isFinite(mm)||mm<=0)
        fail('positive finite millimetre extrusion depth required');
    if(bodies.has(edit.outputBodyId)||extrusions.has(edit.extrudeFeatureId)||
       eventIds.has(edit.eventId))fail('duplicate body, extrusion or journal event');
    bodies.add(edit.outputBodyId);
    extrusions.add(edit.extrudeFeatureId);
    eventIds.add(edit.eventId);
  }
  if(request.edits.some(edit=>extrusions.has(edit.outputBodyId)||
     bodies.has(edit.extrudeFeatureId)))
    fail('aliased body and extrusion identity');
  return {model,runtime};
}
function stage(history,request,services){
  const {model,runtime}=initial(history,request,services);
  let staged=history;
  const outcomes=[];
  for(const edit of request.edits){
    const result=reconfigureProfileExtrusion(staged,{
      ...edit,format:EXTRUSION_RECONFIG_FORMAT,version:1,
      units:'mm',frame:'local_xy',
      expectedRevision:staged.document.revision
    },services);
    staged=result.history;
    outcomes.push(result);
  }
  const prefix=history.document.journal;
  if(!Array.isArray(staged.document.journal)||
     !equal(staged.document.journal.slice(0,prefix.length),prefix))
    throw new Error('machined-family-base: staged journal diverged from source');
  const events=staged.document.journal.slice(prefix.length);
  if(events.length<request.edits.length||
     new Set(events.map(e=>e.eventId)).size!==events.length||
     !request.edits.every(edit=>events.some(e=>e.eventId===edit.eventId&&
       e.featureId===edit.extrudeFeatureId&&e.type==='feature.edit')))
    throw new Error('machined-family-base: staged edits lack stable identities');
  return {model,runtime,staged,outcomes,events};
}
function summary(outcomes,report){
  const state=featureId=>report.features?.find(f=>f.featureId===featureId)?.status;
  return outcomes.map(x=>({
    outputBodyId:x.outputBodyId,
    extrusionFeatureId:x.extrusionFeatureId,
    sourceSketchId:x.sourceSketchId,
    previousDepthMm:x.previousDepthMm,
    depthMm:x.depthMm,
    selectedProfileId:x.selectedProfileId,
    orderedCutFeatureIds:x.orderedCutFeatureIds,
    reboundCutIds:x.reboundCutIds,
    cutDependencyChanges:x.cutDependencyChanges,
    extrusionStatus:state(x.extrusionFeatureId),
    cutStatuses:x.orderedCutFeatureIds.map(featureId=>({featureId,status:state(featureId)}))
  }));
}
/** Read-only UI preflight, never replaces caller's immutable RUNTIME history. */
export function inspectMachinedFamilyBase(history,request,services){
  const {staged,outcomes,events,runtime}=stage(history,request,services);
  return {format:FAMILY_BASE_FORMAT,version:1,kind:'family_base_inspection',
    projectId:request.expectedProjectId,revision:request.expectedRevision,
    documentFence:request.expectedDocumentFence,units:'mm',frame:'local_xy',
    bodies:summary(outcomes,runtime.inspect(staged)),
    eventIds:events.map(e=>e.eventId),atomicFamilyEdit:true,
    providerStatus:'pending_exact_provider',
    exactAuthority:false,independentInteroperability:false};
}
/** One real commit after all selected independently sourced bodies pass admission. */
export function applyMachinedFamilyBase(history,request,services){
  const {model,runtime,staged,outcomes,events}=stage(history,request,services);
  const next=runtime.commit(history,events,history.document.revision);
  if(next.document.revision!==history.document.revision+events.length||
     next.undoStack.length!==history.undoStack.length+1||
     model.serializeProject(next.document)!==model.serializeProject(staged.document))
    throw new Error('machined-family-base: canonical one-frame commit differs from admitted staging');
  const report=runtime.inspect(next);
  const bodies=summary(outcomes,report);
  const updated=new Map(model.featuresOf(next.document).map(x=>[x.id,x]));
  for(const body of bodies){
    const feature=updated.get(body.extrusionFeatureId);
    if(feature?.kind!=='extrude'||
       !equal(feature.writeTargets,[body.outputBodyId])||
       feature.payload?.sourceSketchId!==body.sourceSketchId||
       feature.payload?.thicknessMm!==body.depthMm||
       body.extrusionStatus!=='preview_only'||
       body.cutStatuses.some(x=>!['pending_exact_provider','blocked_dependency']
         .includes(x.status)))
      throw new Error('machined-family-base: semantic body admission failed');
  }
  const invalidation=runtime.diff(history,next);
  if(!bodies.every(body=>
    [body.extrusionFeatureId,...body.orderedCutFeatureIds]
      .every(id=>invalidation.invalidatedFeatureIds?.includes(id))))
    throw new Error('machined-family-base: selected body dependency invalidation missing');
  return {kind:'committed',history:next,report,invalidation,bodies,
    eventIds:events.map(e=>e.eventId),oneUndoFrame:true,
    providerStatus:'pending_exact_provider',
    nativeHandoff:{kind:'runtime_evaluation_required',
      sourceRevision:next.document.revision,
      bodyIds:bodies.map(b=>b.outputBodyId),
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
