/**
 * FEATUREOPS ordered-cut-move/v1. One user drag moves a selected cut across
 * several body writers, with one INTENT transaction / one undo frame.
 * Every intermediate swap is previewed by accepted INTENT. This consumer does
 * not author an independent DAG algorithm, evaluate Booleans or export STEP.
 */
export const ORDERED_CUT_MOVE_FORMAT='intuit3d.feature-ops.ordered-cut-move';
export const ORDERED_CUT_MOVE_VERSION=1;
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
  a.every((x,i)=>x===b[i]);
function fail(reason){throw new TypeError('feature-ops cut move: '+reason);}
function exact(x,fields,label){
  if(!plain(x)||Object.keys(x).length!==fields.length||
     fields.some(k=>!Object.hasOwn(x,k))||
     Object.keys(x).some(k=>!fields.includes(k)))fail('invalid '+label);
}
function id(x,label){if(typeof x!=='string'||!ID.test(x))fail('invalid '+label);return x;}
const row=(report,fid)=>report?.features?.find(x=>x.featureId===fid);
function extentOf(feature){
  const p=feature.payload;
  if(p?.throughAll===true&&!Object.hasOwn(p,'depthMm'))
    return {kind:'through_all'};
  if(p?.throughAll===false&&typeof p.depthMm==='number'&&
     Number.isFinite(p.depthMm)&&p.depthMm>0)
    return {kind:'blind',depthMm:p.depthMm};
  fail('cut has no unambiguous authored extent');
}
function servicesOf(services){
  const {runtime,model,sketch,discovery,cutChain,cutOrder}=services??{};
  if(typeof runtime?.inspect!=='function'||typeof runtime?.diff!=='function'||
     typeof runtime?.commit!=='function'||typeof model?.featuresOf!=='function'||
     typeof sketch?.validateSketch!=='function'||
     typeof discovery?.discoverPlateProfiles!=='function'||
     typeof discovery?.admitDiscoveredPlateProfile!=='function'||
     typeof cutChain?.inspectBodyCutChain!=='function'||
     typeof cutOrder?.previewBodyCutSwap!=='function')
    fail('accepted INTENT, SKETCH and RUNTIME services required');
  return {runtime,model,sketch,discovery,cutChain,cutOrder};
}
function header(history,request,fields){
  exact(request,fields,'request');
  if(request.format!==ORDERED_CUT_MOVE_FORMAT||
     request.version!==ORDERED_CUT_MOVE_VERSION||
     request.units!=='mm'||request.frame!=='local_xy')
    fail('unsupported format, version, units or frame');
  if(!history?.document||
     !Number.isSafeInteger(request.expectedRevision)||
     request.expectedRevision!==history.document.revision||
     request.expectedProjectId!==history.document.projectId)
    throw new Error('feature-ops cut move: stale project/revision');
  id(request.targetBodyId,'target body');
}
function inventory(history,request,services){
  const s=servicesOf(services);
  const bodyId=request.targetBodyId;
  const features=s.model.featuresOf(history.document);
  const writers=features.filter(f=>f.writeTargets?.includes(bodyId));
  const chain=s.cutChain.inspectBodyCutChain(history.document,bodyId);
  if(chain?.status!=='ready'||chain.projectId!==request.expectedProjectId||
     chain.revision!==request.expectedRevision||
     !Array.isArray(chain.bodyWriterIds)||
     !same(chain.bodyWriterIds.map(String).sort(),writers.map(f=>f.id).sort()))
    fail('body writer selection is stale, unavailable or ambiguous');
  const roots=writers.filter(f=>f.kind==='extrude'&&same(f.writeTargets,[bodyId]));
  if(roots.length!==1||writers.length<3)
    fail('at least two ordered cuts and one unique extrusion required');
  const root=roots[0];
  const all=new Set(writers.map(f=>f.id));
  const order=[root.id],visited=new Set(order);
  while(order.length<writers.length){
    const previous=order.at(-1);
    const successors=writers.filter(f=>f.kind==='cut'&&!visited.has(f.id)&&
      same(f.writeTargets,[bodyId])&&f.payload?.targetBodyId===bodyId&&
      f.dependsOn?.filter(d=>all.has(d)).length===1&&
      f.dependsOn.includes(previous));
    if(successors.length!==1)fail('no unique sequential body cut order');
    order.push(successors[0].id);
    visited.add(successors[0].id);
  }
  if(order.at(-1)!==chain.eligibleAfterWriterId)
    fail('writer order disagrees with INTENT terminal');
  const report=s.runtime.inspect(history);
  if(row(report,root.id)?.status!=='preview_only')
    fail('extrusion is not an admitted model-owned preview');
  const byId=new Map(features.map(f=>[f.id,f]));
  const selections=[];
  for(const fid of order.slice(1)){
    const cut=byId.get(fid);
    if(cut?.kind!=='cut'||cut.payload?.units!=='mm'||
       cut.payload?.frame!=='local_xy'||!same(cut.writeTargets,[bodyId]))
      fail('unsupported cut body/units/frame');
    const sketchId=id(cut.payload?.sourceSketchId,'source sketch');
    const candidate=id(cut.payload?.profileCandidateId,'SKETCH profile');
    if(!candidate.startsWith('cycle:')||candidate.length>8192)
      fail('canonical selected SKETCH cycle required');
    const source=byId.get(sketchId);
    if(source?.kind!=='sketch'||!source.payload?.sketch||
       !same(source.writeTargets,[]))
      fail('selected source sketch missing');
    const authored=s.sketch.validateSketch(source.payload.sketch);
    const proposals=s.discovery.discoverPlateProfiles(authored);
    if(proposals?.status!=='ready'||proposals.candidates?.length!==1||
       proposals.candidates[0].id!==candidate)
      fail('selected SKETCH source is stale or ambiguous');
    const admitted=s.discovery.admitDiscoveredPlateProfile(authored,proposals,candidate);
    const proof=row(report,sketchId);
    if(proof?.status!=='analytic_profile_only'||
       proof.profile?.status!=='analytic_profile_only'||
       JSON.stringify(proof.profile)!==JSON.stringify(admitted))
      fail('RUNTIME has not admitted current SKETCH profile');
    if(!['pending_exact_provider','blocked_dependency'].includes(row(report,fid)?.status))
      fail('cut no longer has recoverable pending native status');
    selections.push({cutFeatureId:fid,sourceSketchId:sketchId,
      profileCandidateId:candidate,extent:extentOf(cut)});
  }
  return {s,features,report,order,selections};
}
/**
 * Read-only authoritative inspector for a drag/drop inspector. Returns actual
 * dependency order (not journal chronology), selected profile/extent fences,
 * and explicit anchors to drop a cut AFTER. This does not infer a target body.
 */
export function inspectOrderedBodyCutMove(history,request,services){
  header(history,request,['format','version','expectedProjectId','expectedRevision',
    'units','frame','targetBodyId']);
  const {order,selections}=inventory(history,request,services);
  return {format:ORDERED_CUT_MOVE_FORMAT,version:1,kind:'selection',
    projectId:request.expectedProjectId,revision:request.expectedRevision,
    bodyId:request.targetBodyId,writerOrder:order,cutSelections:selections,
    dropAfterWriterIds:order,exactAuthority:false,independentInteroperability:false};
}
/**
 * Move one named cut after another named body writer across >=1 positions.
 * INTENT previews each adjacent physical dependency swap on the successively
 * staged document; all returned events commit AT ONCE through RUNTIME.
 * There is no partially committed drag or multi-undo ladder.
 */
export function moveOrderedBodyCut(history,request,services){
  header(history,request,['format','version','expectedProjectId','expectedRevision',
    'units','frame','targetBodyId','cutFeatureId','dropAfterWriterId',
    'expectedWriterOrder','cutSelections','eventIdPrefix']);
  const moved=id(request.cutFeatureId,'cut to move');
  const anchor=id(request.dropAfterWriterId,'drop-after writer');
  const prefix=id(request.eventIdPrefix,'event ID prefix');
  if(prefix.length>85)fail('event ID prefix too long');
  const state=inventory(history,request,services);
  const {s,features,order,selections}=state;
  if(!same(order,request.expectedWriterOrder)||
     JSON.stringify(selections)!==JSON.stringify(request.cutSelections))
    fail('inspector selection has changed');
  if(!order.slice(1).includes(moved)||!order.includes(anchor)||moved===anchor)
    fail('moving cut and explicit drop anchor must belong to selected body');
  const reduced=order.filter(fid=>fid!==moved);
  const target=reduced.indexOf(anchor)+1;
  const desired=[...reduced.slice(0,target),moved,...reduced.slice(target)];
  const from=order.indexOf(moved),to=desired.indexOf(moved);
  if(from===to)fail('requested move would not change body execution order');
  let staged=history.document,current=[...order],cursor=from;
  const events=[],steps=[];
  while(cursor!==to){
    const forward=cursor<to;
    const firstIndex=forward?cursor:cursor-1;
    const first=current[firstIndex],second=current[firstIndex+1];
    if(firstIndex<1||!first||!second)fail('reorder would move extrusion root');
    const count=firstIndex+2<current.length?3:2;
    const eventIds=Array.from({length:count},(_,j)=>
      prefix+'.swap'+steps.length+'.edit'+j);
    const preview=s.cutOrder.previewBodyCutSwap(staged,{
      format:'intuit3d.body-cut-order',version:1,
      expectedProjectId:request.expectedProjectId,expectedRevision:staged.revision,
      targetBodyId:request.targetBodyId,firstCutFeatureId:first,
      secondCutFeatureId:second,eventIds
    });
    const nextOrder=[...current];
    [nextOrder[firstIndex],nextOrder[firstIndex+1]]=
      [nextOrder[firstIndex+1],nextOrder[firstIndex]];
    if(!same(preview?.writerOrderBefore,current)||
       !same(preview?.writerOrderAfter,nextOrder)||
       !Array.isArray(preview.events)||preview.events.length!==count||
       !preview.events.every((e,j)=>e.type==='feature.edit'&&
         e.eventId===eventIds[j])||
       preview.document?.projectId!==request.expectedProjectId||
       preview.document.revision!==staged.revision+count||
       preview.exactGeometryAuthority!==false||
       preview.requiresNativeRebuild!==true||
       preview.authoredTimelineChanged!==false)
      fail('INTENT rejected or altered a staged reorder');
    events.push(...preview.events);
    steps.push({firstCutFeatureId:first,secondCutFeatureId:second,eventIds});
    staged=preview.document;
    current=nextOrder;
    cursor+=forward?1:-1;
  }
  if(!same(current,desired))fail('staged move differs from requested destination');
  const next=s.runtime.commit(history,events,request.expectedRevision);
  if(next.document.revision!==request.expectedRevision+events.length||
     next.undoStack.length!==history.undoStack.length+1)
    throw new Error('feature-ops cut move: non-atomic committed drag');
  const actual=new Map(s.model.featuresOf(next.document).map(f=>[f.id,f]));
  const previous=new Map(features.map(f=>[f.id,f]));
  const bodyWriters=new Set(order);
  for(let i=0;i<desired.length;i++){
    const fid=desired[i],before=previous.get(fid),after=actual.get(fid);
    if(!before||!after||before.kind!==after.kind||
       !same(before.writeTargets,after.writeTargets)||
       JSON.stringify(before.payload)!==JSON.stringify(after.payload)||
       (i>0&&(!after.dependsOn.includes(desired[i-1])||
         after.dependsOn.filter(x=>bodyWriters.has(x)).length!==1))||
       !same(before.dependsOn.filter(x=>!bodyWriters.has(x)),
         after.dependsOn.filter(x=>!bodyWriters.has(x))))
      throw new Error('feature-ops cut move: committed lineage/identity mismatch');
  }
  const terminal=s.cutChain.inspectBodyCutChain(next.document,request.targetBodyId);
  if(terminal?.status!=='ready'||terminal.eligibleAfterWriterId!==desired.at(-1))
    throw new Error('feature-ops cut move: resulting body has no unique terminal');
  const report=s.runtime.inspect(next),invalidation=s.runtime.diff(history,next);
  const changed=order.slice(1).filter(fid=>
    !same(previous.get(fid).dependsOn,actual.get(fid).dependsOn));
  if(!changed.length||!changed.every(fid=>
      invalidation?.invalidatedFeatureIds?.includes(fid)))
    throw new Error('feature-ops cut move: incomplete dependency invalidation');
  const statuses=desired.slice(1).map(fid=>{
    const status=row(report,fid)?.status;
    if(!['pending_exact_provider','blocked_dependency'].includes(status))
      throw new Error('feature-ops cut move: post-edit native state is not pending');
    return {cutFeatureId:fid,status};
  });
  return {kind:'committed',history:next,report,invalidation,
    writerOrderBefore:order,writerOrderAfter:desired,
    movedCutFeatureId:moved,dropAfterWriterId:anchor,swapSteps:steps,
    eventIds:events.map(e=>e.eventId),statuses,
    authoredTimelineChanged:false,
    nativeHandoff:{kind:'runtime_evaluation_required',bodyId:request.targetBodyId,
      sourceRevision:next.document.revision,orderedWriterIds:desired,
      compatibility:'not_claimed_ask_RUNTIME_provider',
      exactAuthority:false,independentInteroperability:false},
    exactAuthority:false,independentInteroperability:false};
}
