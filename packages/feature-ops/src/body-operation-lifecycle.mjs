/**
 * FEATUREOPS body-operation-lifecycle/v1 — a user-selectable, revision-fenced
 * remove/restore surface over INTENT's feature-lifecycle authority.
 * Deletion is a durable tombstone, not a mesh hide or geometrical Boolean.
 * Missing parents remain visible as unresolved intent until deliberately repaired.
 */
export const BODY_OPERATION_LIFECYCLE_FORMAT='intuit3d.feature-ops.body-operation-lifecycle';
export const BODY_OPERATION_LIFECYCLE_VERSION=1;
const MODEL_FORMAT='intuit3d.feature-lifecycle';
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const own=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
function fail(reason){throw new TypeError('feature-ops lifecycle: '+reason);}
function exact(x,fields,label){
  if(!own(x)||Object.keys(x).length!==fields.length||
    fields.some(f=>!Object.hasOwn(x,f))||
    Object.keys(x).some(f=>!fields.includes(f))) fail('invalid '+label);
}
function id(v,label){if(typeof v!=='string'||!ID.test(v))fail('invalid '+label);return v;}
function distinct(values,label){
  if(!Array.isArray(values)||new Set(values).size!==values.length)
    fail('duplicate or invalid '+label);
  values.forEach(v=>id(v,label));
}
function same(a,b){return Array.isArray(a)&&Array.isArray(b)&&
  a.length===b.length&&a.every((x,i)=>x===b[i]);}
function state(report,featureId){return report.features?.find(f=>f.featureId===featureId);}
function servicesOf(services){
  const {runtime,model,lifecycle}=services??{};
  if(typeof runtime?.inspect!=='function'||typeof runtime?.diff!=='function'||
     typeof model?.featuresOf!=='function'||
     typeof lifecycle?.inspectFeatureRemoval!=='function'||
     typeof lifecycle?.previewFeatureRemoval!=='function'||
     typeof lifecycle?.previewFeatureRestoration!=='function'||
     typeof lifecycle?.commitUndoableFeatureRemoval!=='function'||
     typeof lifecycle?.commitUndoableFeatureRestoration!=='function')
    fail('accepted INTENT feature-lifecycle and RUNTIME services required');
  return {runtime,model,lifecycle};
}
function header(history,request,fields,services){
  exact(request,fields,'request');
  if(request.format!==BODY_OPERATION_LIFECYCLE_FORMAT||
     request.version!==BODY_OPERATION_LIFECYCLE_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported contract or local_xy mm frame');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     request.expectedRevision!==history.document.revision||
     request.expectedProjectId!==history.document.projectId)
    throw new Error('feature-ops lifecycle: stale project/revision');
  id(request.targetBodyId,'targetBodyId');
  return servicesOf(services);
}
function bodyWriter(feature,bodyId){
  return feature&&['cut','extrude'].includes(feature.kind)&&
    same(feature.writeTargets,[bodyId])&&
    (feature.kind!=='cut'||feature.payload?.targetBodyId===bodyId);
}
function selection(history,request,services){
  const selectedId=id(request.featureId,'featureId');
  if(selectedId===request.targetBodyId) fail('aliased body and feature');
  const features=services.model.featuresOf(history.document);
  const selected=features.find(f=>f.id===selectedId);
  if(!bodyWriter(selected,request.targetBodyId))
    fail('selected operation is not an active, explicit writer of this body');
  const impact=services.lifecycle.inspectFeatureRemoval(history.document,selectedId);
  if(impact.projectId!==request.expectedProjectId||
     impact.revision!==request.expectedRevision||impact.featureId!==selectedId)
    fail('INTENT returned inconsistent dependency impact');
  return {selected,features,impact};
}

/** Read-only, user-visible impact before a destructive action is confirmed. */
export function inspectSelectedBodyRemoval(history,request,services){
  const s=header(history,request,['format','version','expectedProjectId',
    'expectedRevision','units','frame','targetBodyId','featureId'],services);
  const {selected,features,impact}=selection(history,request,s);
  return {format:BODY_OPERATION_LIFECYCLE_FORMAT,version:1,kind:'impact',
    projectId:request.expectedProjectId,revision:request.expectedRevision,
    bodyId:request.targetBodyId,featureId:selected.id,featureKind:selected.kind,
    directDependents:impact.directDependents,
    transitiveDependents:impact.transitiveDependents,
    cascadeIds:impact.cascadeIds,
    dependentBodyWriters:impact.transitiveDependents.filter(fid=>
      bodyWriter(features.find(f=>f.id===fid),request.targetBodyId)),
    exactAuthority:false};
}

/**
 * Remove one selected extrusion/cut. Three explicit modes:
 * reject_if_referenced; keep_dependents_pending (recoverable); or confirmed
 * same-body cascade. No dependent silently disappears from the journal.
 */
export function removeSelectedBodyOperation(history,request,services){
  const s=header(history,request,['format','version','expectedProjectId',
    'expectedRevision','units','frame','targetBodyId','featureId',
    'expectedDependents','mode','confirmCascade','eventIds'],services);
  distinct(request.expectedDependents,'expectedDependents');
  const {features,impact}=selection(history,request,s);
  if(!same(request.expectedDependents,impact.transitiveDependents))
    fail('selection or downstream dependencies have changed');
  if(!['reject_if_referenced','keep_dependents_pending',
      'cascade_descendants'].includes(request.mode)||
      typeof request.confirmCascade!=='boolean')
    fail('invalid removal mode/confirmation');
  if(request.mode==='cascade_descendants'&&impact.transitiveDependents.length){
    if(!request.confirmCascade) fail('cascade must be explicitly confirmed');
    if(impact.transitiveDependents.some(fid=>
        !bodyWriter(features.find(f=>f.id===fid),request.targetBodyId)))
      fail('cascade crosses another body or non-body dependency; use INTENT explicitly');
  }
  distinct(request.eventIds,'eventIds');
  const victims=request.mode==='cascade_descendants'?
    impact.cascadeIds:[request.featureId];
  if(request.eventIds.length!==victims.length)
    fail('wrong number of event IDs');
  const modelRequest={format:MODEL_FORMAT,version:1,action:'remove',
    expectedProjectId:request.expectedProjectId,
    expectedRevision:request.expectedRevision,featureId:request.featureId,
    mode:request.mode,confirmCascade:request.confirmCascade,
    eventIds:request.eventIds};
  const preview=s.lifecycle.previewFeatureRemoval(history.document,modelRequest);
  if(preview.exactGeometryAuthority!==false||
     !same(preview.affectedFeatureIds,[...victims].reverse())||
     preview.events.length!==victims.length)
    fail('INTENT removal preview changed selected victim set');
  const next=s.lifecycle.commitUndoableFeatureRemoval(history,modelRequest);
  if(next.document.revision!==request.expectedRevision+victims.length)
    throw new Error('feature-ops lifecycle: incorrect committed revision');
  const remaining=s.model.featuresOf(next.document);
  if(victims.some(fid=>remaining.some(f=>f.id===fid)))
    throw new Error('feature-ops lifecycle: removed feature is still active');
  const report=s.runtime.inspect(next);
  return {kind:'committed',action:'remove',history:next,report,
    invalidation:s.runtime.diff(history,next),impact,
    removedFeatureIds:preview.affectedFeatureIds,
    retainedDependentStatuses:impact.transitiveDependents.filter(fid=>
      !victims.includes(fid)).map(fid=>({
        featureId:fid,status:state(report,fid)?.status??'missing'
      })),
    structuralInvalidation:preview.invalidation,
    nativeHandoff:{kind:'invalidate_previous_body_geometry',bodyId:request.targetBodyId,
      sourceRevision:next.document.revision,exactAuthority:false},
    exactAuthority:false,independentInteroperability:false};
}

/** Restore named tombstones in a single undo frame; do not infer replacements. */
export function restoreSelectedBodyOperations(history,request,services){
  const s=header(history,request,['format','version','expectedProjectId',
    'expectedRevision','units','frame','targetBodyId','featureIds',
    'eventIds','admission'],services);
  distinct(request.featureIds,'featureIds');
  distinct(request.eventIds,'eventIds');
  if(request.featureIds.length<1||request.featureIds.length>64||
     request.featureIds.length!==request.eventIds.length||
     request.featureIds.includes(request.targetBodyId)||
     !['require_ready','permit_unresolved'].includes(request.admission))
    fail('invalid tombstones, event IDs or admission mode');
  const modelRequest={format:MODEL_FORMAT,version:1,action:'restore',
    expectedProjectId:request.expectedProjectId,expectedRevision:request.expectedRevision,
    featureIds:request.featureIds,eventIds:request.eventIds,
    admission:request.admission};
  const preview=s.lifecycle.previewFeatureRestoration(history.document,modelRequest);
  const projected=s.model.featuresOf(preview.document);
  if(preview.exactGeometryAuthority!==false||
     !same(preview.affectedFeatureIds,request.featureIds)||
     request.featureIds.some(fid=>!bodyWriter(projected.find(f=>f.id===fid),
       request.targetBodyId)))
    fail('restore would change or misidentify selected body writers');
  const next=s.lifecycle.commitUndoableFeatureRestoration(history,modelRequest);
  const restored=s.model.featuresOf(next.document);
  if(next.document.revision!==request.expectedRevision+request.featureIds.length||
     request.featureIds.some(fid=>!bodyWriter(restored.find(f=>f.id===fid),
       request.targetBodyId)))
    throw new Error('feature-ops lifecycle: restored body identity mismatch');
  const report=s.runtime.inspect(next);
  return {kind:'committed',action:'restore',history:next,report,
    invalidation:s.runtime.diff(history,next),
    restoredFeatureIds:request.featureIds,
    statuses:request.featureIds.map(fid=>({featureId:fid,
      status:state(report,fid)?.status??'missing'})),
    structuralInvalidation:preview.invalidation,
    nativeHandoff:{kind:'runtime_evaluation_required',bodyId:request.targetBodyId,
      sourceRevision:next.document.revision,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
