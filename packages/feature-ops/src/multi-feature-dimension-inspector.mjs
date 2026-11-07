/**
 * Read-only WORKBENCH selection/Apply adapter for multi-feature-dimensions/v1.
 *
 * Rows contain current, explicit authoritative selections, not authority
 * tokens: editMultipleBodyDimensions() re-admits every row before commit.
 */
const FORMAT='intuit3d.feature-ops.multi-feature-dimensions';
const VERSION=1;
const IDENT=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
function fail(reason){throw new TypeError('feature-ops dimension selection: '+reason);}
function exact(x,fields,label){
  if(!plain(x)||Object.keys(x).length!==fields.length||
     fields.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!fields.includes(k)))
    fail('invalid '+label);
}
function id(value,label){
  if(typeof value!=='string'||!IDENT.test(value))fail('invalid '+label);
  return value;
}
function positive(value,label){
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0)
    fail('positive finite '+label+' in mm required');
  return value;
}
function validateExtent(value,label){
  exact(value,value?.kind==='blind'?['kind','depthMm']:['kind'],label);
  if(value.kind==='blind')positive(value.depthMm,label+'.depthMm');
  else if(value.kind!=='through_all')fail('unsupported '+label);
}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function same(a,b){return Array.isArray(a)&&Array.isArray(b)&&
  a.length===b.length&&a.every((x,i)=>x===b[i]);}
function reportRow(report,featureId){return report.features?.find(r=>r.featureId===featureId);}
function mustServices(services){
  const {runtime,model,sketch,discovery,cutChain}=services??{};
  if(typeof runtime?.inspect!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof cutChain?.inspectBodyCutChain!=='function'||
     typeof cutChain?.inspectBodyCutExtent!=='function')
    fail('accepted read-only INTENT/SKETCH/RUNTIME services required');
  return {runtime,model,sketch,discovery,cutChain};
}

/** Read-only, revision-fenced selection for a multi-row dimensions inspector. */
export function inspectSelectedFeatureDimensions(history,request,services){
  exact(request,['expectedProjectId','expectedRevision','selections'],'request');
  id(request.expectedProjectId,'expectedProjectId');
  if(!history?.document||!Number.isSafeInteger(request.expectedRevision)||
     history.document.projectId!==request.expectedProjectId||
     history.document.revision!==request.expectedRevision)
    throw new Error('feature-ops dimension selection: stale project/revision');
  if(!Array.isArray(request.selections)||request.selections.length<2||
     request.selections.length>16)fail('2–16 explicit selected features required');
  const selectedIds=new Set();
  for(const selection of request.selections){
    exact(selection,['featureId','targetBodyId'],'selection');
    const featureId=id(selection.featureId,'featureId');
    id(selection.targetBodyId,'targetBodyId');
    if(selectedIds.has(featureId))fail('duplicate selected feature');
    selectedIds.add(featureId);
  }
  const {runtime,model,sketch,discovery,cutChain}=mustServices(services);
  const features=model.featuresOf(history.document);
  const byId=new Map(features.map(f=>[f.id,f]));
  if(byId.size!==features.length)fail('duplicate authoritative feature IDs');
  const report=runtime.inspect(history);
  const chainCache=new Map(),profileCache=new Map();
  function chain(bodyId){
    if(!chainCache.has(bodyId)){
      const result=cutChain.inspectBodyCutChain(history.document,bodyId);
      if(result?.status!=='ready'||result.projectId!==request.expectedProjectId||
         result.revision!==request.expectedRevision||
         !Array.isArray(result.bodyWriterIds)||result.bodyWriterIds.length===0||
         new Set(result.bodyWriterIds).size!==result.bodyWriterIds.length)
        fail('body has stale or ambiguous ordered writers');
      chainCache.set(bodyId,result.bodyWriterIds);
    }
    return chainCache.get(bodyId);
  }
  function sourceProfile(sketchId){
    if(!profileCache.has(sketchId)){
      const source=byId.get(sketchId);
      if(source?.kind!=='sketch'||!source.payload?.sketch||
         !same(source.writeTargets,[]))fail('selected sketch missing or ambiguous');
      const authored=sketch.validateSketch(source.payload.sketch);
      const found=discovery.discoverPlateProfiles(authored);
      if(found?.status!=='ready'||found.candidates?.length!==1)
        fail('SKETCH has no unique solved profile');
      const candidate=found.candidates[0].id;
      if(typeof candidate!=='string'||!candidate.startsWith('cycle:')||
         candidate.length>8192)fail('canonical selected profile required');
      const admitted=discovery.admitDiscoveredPlateProfile(authored,found,candidate);
      const evaluated=reportRow(report,sketchId);
      if(evaluated?.status!=='analytic_profile_only'||
         evaluated.profile?.status!=='analytic_profile_only'||
         !equal(evaluated.profile,admitted))
        fail('RUNTIME did not admit the selected SKETCH profile');
      profileCache.set(sketchId,candidate);
    }
    return profileCache.get(sketchId);
  }
  const rows=[];
  for(const selection of request.selections){
    const {featureId,targetBodyId:bodyId}=selection;
    const f=byId.get(featureId);
    if(!f||!['extrude','cut'].includes(f.kind)||
       !same(f.writeTargets,[bodyId])||
       f.payload?.units!=='mm'||f.payload?.frame!=='local_xy')
      fail('selected feature is not a supported explicit body writer');
    const sketchId=id(f.payload.sourceSketchId,'sourceSketchId');
    const candidate=sourceProfile(sketchId);
    const writers=chain(bodyId),position=writers.indexOf(featureId);
    if(position<0)fail('selected feature is not in the current body chain');
    const status=reportRow(report,featureId)?.status;
    if(f.kind==='extrude'){
      if(position!==0||!same(f.dependsOn,[sketchId])||status!=='preview_only')
        fail('extrusion is not the uniquely admissible first body writer');
      const depthMm=positive(f.payload.thicknessMm,'current extrusion depth');
      rows.push({kind:'extrusion_depth',featureId,targetBodyId:bodyId,
        sourceSketchId:sketchId,profileCandidateId:candidate,
        currentDepthMm:depthMm,status});
      continue;
    }
    const preceding=writers[position-1];
    if(position===0||!preceding||!same(f.dependsOn,[preceding,sketchId])||
       f.payload.targetBodyId!==bodyId||
       f.payload.profileCandidateId!==candidate||
       !['pending_exact_provider','blocked_dependency'].includes(status))
      fail('cut has stale or ambiguous source, predecessor or evaluation');
    const inspected=cutChain.inspectBodyCutExtent(history.document,featureId,bodyId);
    if(inspected?.projectId!==request.expectedProjectId||
       inspected.revision!==request.expectedRevision||
       inspected.semanticStatus!=='ready')
      fail('INTENT did not admit the current cut extent');
    validateExtent(inspected.extent,'current cut extent');
    if(f.payload.throughAll!==(inspected.extent.kind==='through_all')||
       (inspected.extent.kind==='blind'?
         f.payload.depthMm!==inspected.extent.depthMm:
         Object.hasOwn(f.payload,'depthMm')))
      fail('INTENT cut extent differs from authored payload');
    rows.push({kind:'cut_extent',featureId,targetBodyId:bodyId,
      afterBodyWriterId:preceding,sourceSketchId:sketchId,
      profileCandidateId:candidate,
      currentExtent:inspected.extent.kind==='through_all'?{kind:'through_all'}:
        {kind:'blind',depthMm:inspected.extent.depthMm},status});
  }
  return {kind:'editable_dimension_selection',format:FORMAT,version:VERSION,
    expectedProjectId:request.expectedProjectId,expectedRevision:request.expectedRevision,
    units:'mm',frame:'local_xy',rows,exactAuthority:false,
    independentInteroperability:false};
}

/**
 * Assemble Apply from current rows and new values. The editor must revalidate
 * against the actual UndoHistory; an old snapshot cannot authorize a write.
 */
export function prepareSelectedFeatureDimensionEdits(snapshot,proposed){
  exact(snapshot,['kind','format','version','expectedProjectId',
    'expectedRevision','units','frame','rows','exactAuthority',
    'independentInteroperability'],'selection snapshot');
  if(snapshot.kind!=='editable_dimension_selection'||snapshot.format!==FORMAT||
     snapshot.version!==VERSION||snapshot.units!=='mm'||
     snapshot.frame!=='local_xy'||snapshot.exactAuthority!==false||
     snapshot.independentInteroperability!==false)
    fail('unsupported selection snapshot');
  id(snapshot.expectedProjectId,'expectedProjectId');
  if(!Number.isSafeInteger(snapshot.expectedRevision)||snapshot.expectedRevision<0)
    fail('invalid source revision');
  if(!Array.isArray(snapshot.rows)||snapshot.rows.length<2||
     snapshot.rows.length>16||!Array.isArray(proposed)||
     proposed.length!==snapshot.rows.length)
    fail('all 2–16 selected rows need a new value');
  const rows=new Map(),edits=new Map(),eventIds=new Set();
  for(const row of snapshot.rows){
    const isExtrude=row?.kind==='extrusion_depth';
    exact(row,isExtrude?['kind','featureId','targetBodyId',
      'sourceSketchId','profileCandidateId','currentDepthMm','status']:
      ['kind','featureId','targetBodyId','afterBodyWriterId',
        'sourceSketchId','profileCandidateId','currentExtent','status'],
    'selected row');
    const featureId=id(row.featureId,'featureId');
    id(row.targetBodyId,'targetBodyId');
    id(row.sourceSketchId,'sourceSketchId');
    if(typeof row.profileCandidateId!=='string'||
       !row.profileCandidateId.startsWith('cycle:')||
       row.profileCandidateId.length>8192)fail('invalid source profile');
    if(isExtrude){
      positive(row.currentDepthMm,'currentDepthMm');
      if(row.status!=='preview_only')fail('unready extrusion selection');
    }else{
      if(row.kind!=='cut_extent')fail('unsupported selected kind');
      id(row.afterBodyWriterId,'afterBodyWriterId');
      validateExtent(row.currentExtent,'currentExtent');
      if(!['pending_exact_provider','blocked_dependency'].includes(row.status))
        fail('unready cut selection');
    }
    if(rows.has(featureId))fail('duplicate selected row');
    rows.set(featureId,row);
  }
  for(const change of proposed){
    const row=rows.get(change?.featureId);
    if(!row)fail('proposed feature not selected');
    exact(change,row.kind==='extrusion_depth'?['featureId','eventId','toDepthMm']:
      ['featureId','eventId','toExtent'],'proposed edit');
    const eventId=id(change.eventId,'eventId');
    if(eventIds.has(eventId)||edits.has(change.featureId))
      fail('duplicate event/feature edit');
    eventIds.add(eventId);
    if(row.kind==='extrusion_depth'){
      positive(change.toDepthMm,'toDepthMm');
      if(change.toDepthMm===row.currentDepthMm)fail('no-op extrusion depth');
      edits.set(row.featureId,{kind:'extrusion_depth',eventId,
        extrudeFeatureId:row.featureId,targetBodyId:row.targetBodyId,
        sourceSketchId:row.sourceSketchId,profileCandidateId:row.profileCandidateId,
        fromDepthMm:row.currentDepthMm,toDepthMm:change.toDepthMm});
    }else{
      validateExtent(change.toExtent,'toExtent');
      if(equal(row.currentExtent,change.toExtent))fail('no-op cut extent');
      edits.set(row.featureId,{kind:'cut_extent',eventId,
        cutFeatureId:row.featureId,targetBodyId:row.targetBodyId,
        afterBodyWriterId:row.afterBodyWriterId,
        sourceSketchId:row.sourceSketchId,profileCandidateId:row.profileCandidateId,
        fromExtent:row.currentExtent,toExtent:change.toExtent.kind==='through_all'?
          {kind:'through_all'}:{kind:'blind',depthMm:change.toExtent.depthMm}});
    }
  }
  return {format:FORMAT,version:VERSION,
    expectedProjectId:snapshot.expectedProjectId,
    expectedRevision:snapshot.expectedRevision,units:'mm',frame:'local_xy',
    edits:snapshot.rows.map(row=>edits.get(row.featureId))};
}
