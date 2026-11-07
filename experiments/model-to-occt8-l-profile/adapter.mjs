/** Isolated, fail-closed RUNTIME -> pinned OCCT8 L-profile-v3 adapter.
 * INPUT: authenticated requestFromRuntimeBodyCutChain result + SKETCH
 * re-admission/provenance from the same accepted history. Not a CAD engine.
 */
export const EXPERIMENT_PROTOCOL='intuit3d.experiment.runtime-occt8-l-profile.v1';
const ID=/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const near=(a,b)=>typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8;
const need=(ok,msg)=>{if(!ok)throw new TypeError('runtime→OCCT8 L adapter: '+msg)};
const validId=x=>typeof x==='string'&&ID.test(x);
function requireLoop(profile,n,label){
 need(profile?.format==='intuit3d.analytic-arc-profile'&&profile.version===1&&
 profile.units==='mm'&&profile.providerSubmissionReady===true&&
 profile.globalSelfIntersectionChecked===true&&profile.holeContainmentChecked===true&&
 profile.nativeProfileAdmissible===false&&profile.stepQualified===false&&
 typeof profile.sourceSignature==='string'&&profile.sourceSignature.length>0&&
 profile.sourceSignature.length<=262144&&Array.isArray(profile.boundary)&&
 profile.boundary.length===n&&Array.isArray(profile.holes)&&profile.holes.length===0,
 label+' needs a solver-admitted, hole-free linear profile');
 const points=[];
 for(const e of profile.boundary){
  need(e?.kind==='line'&&validId(e.id)&&Number.isFinite(e.start?.x)&&
    Number.isFinite(e.start?.y)&&Number.isFinite(e.end?.x)&&Number.isFinite(e.end?.y),
    label+' has unsupported edge');
  need((near(e.start.x,e.end.x)&&!near(e.start.y,e.end.y))||
   (!near(e.start.x,e.end.x)&&near(e.start.y,e.end.y)),
    label+' must have nondegenerate axis-aligned lines');
  points.push([e.start.x,e.start.y]);
 }
 for(let i=0;i<n;i++){const q=profile.boundary[(i+1)%n].start,end=profile.boundary[i].end;
  need(near(end.x,q.x)&&near(end.y,q.y),label+' is not a closed ordered loop');}
 const twice=points.reduce((sum,p,i)=>{const q=points[(i+1)%n];
  return sum+p[0]*q[1]-q[0]*p[1]},0);
 need(twice>0&&near(twice/2,profile.signedBoundaryAreaMm2)&&
  near(twice/2,profile.materialAreaMm2),label+' signed area disagrees with sketch');
 return points;
}
function sameCycle(points,canonical){return canonical.some((_,shift)=>
 points.every((p,i)=>{const q=canonical[(i+shift)%canonical.length];
 return near(p[0],q[0])&&near(p[1],q[1])}));}
function lGeometry(profile){
 const p=requireLoop(profile,6,'base'),xs=p.map(x=>x[0]),ys=p.map(x=>x[1]);
 const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
 const width=xmax-xmin,depth=ymax-ymin;
 need(width>=1e-6&&depth>=1e-6&&near(xmin,-width/2)&&near(xmax,width/2)&&
  near(ymin,-depth/2)&&near(ymax,depth/2),
  'translated/rotated L not supported by pinned centred native frame');
 const xi=xs.filter(x=>!near(x,xmin)&&!near(x,xmax));
 const yi=ys.filter(y=>!near(y,ymin)&&!near(y,ymax));
 need(xi.length===2&&near(xi[0],xi[1])&&yi.length===2&&near(yi[0],yi[1]),
  'not a single six-edge orthogonal L');
 const legWidth=xi[0]-xmin,footHeight=yi[0]-ymin;
 need(legWidth>0&&legWidth<width&&footHeight>0&&footHeight<depth,
  'invalid L arm dimensions');
 need(sameCycle(p,[[xmin,ymin],[xmax,ymin],[xmax,yi[0]],[
  xi[0],yi[0]],[xi[0],ymax],[xmin,ymax]]),
  'noncanonical six-edge L or reversed winding');
 need(near(profile.materialAreaMm2,width*footHeight+
  legWidth*(depth-footHeight)),'L material area mismatch');
 return {width,depth,legWidth,footHeight};
}
function rectGeometry(profile,label){
 const p=requireLoop(profile,4,label),xs=p.map(x=>x[0]),ys=p.map(x=>x[1]);
 const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
 const width=xmax-xmin,depth=ymax-ymin;
 need(width>=1e-6&&depth>=1e-6&&
  sameCycle(p,[[xmin,ymin],[xmax,ymin],[xmax,ymax],[xmin,ymax]])&&
  near(width*depth,profile.materialAreaMm2),
  label+' is not a filled axis-aligned rectangle');
 return {x:(xmin+xmax)/2,y:(ymin+ymax)/2,width,depth};
}
export function mapAdmittedChainToPinnedL(chain,selection,currentRevision){
 need(chain?.protocol==='intuit3d/kernel/profile-body-cut-chain-v3'&&
 chain.units==='mm'&&validId(chain.requestId)&&validId(chain.targetBodyId)&&
 Number.isSafeInteger(chain.revision)&&chain.revision>=0&&
 chain.revision===currentRevision&&typeof chain.exportStep==='boolean',
 'stale or non-authoritative runtime chain');
 need(selection?.projectId&&selection.revision===chain.revision&&
  validId(selection.baseSketchId)&&
  typeof selection.baseProfileCandidateId==='string'&&
  selection.baseProfileCandidateId.startsWith('cycle:')&&
  Array.isArray(selection.cuts)&&selection.cuts.length===2,
  'same-revision selected SKETCH evidence required');
 need(chain.baseExtrude?.protocol==='intuit3d/kernel/arc-extrude-v1'&&
  chain.baseExtrude.revision===chain.revision&&chain.baseExtrude.units==='mm'&&
  chain.baseExtrude.exportStep===false&&
  Number.isFinite(chain.baseExtrude.thicknessMm)&&chain.baseExtrude.thicknessMm>0,
  'authoritative RUNTIME extrusion required');
 need(chain.baseExtrude.profile.sourceSignature===selection.baseSourceSignature,
  'selected base sketch source changed');
 const l=lGeometry(chain.baseExtrude.profile),thickness=chain.baseExtrude.thicknessMm;
 need(Array.isArray(chain.cuts)&&chain.cuts.length===2,'two explicitly ordered body cuts required');
 const seen=new Set([chain.targetBodyId,selection.baseSketchId]);
 const cuts=chain.cuts.map((item,i)=>{
  const proof=selection.cuts[i],tool=item?.cutTool;
  need(validId(item?.cutFeatureId)&&!seen.has(item.cutFeatureId)&&
   item.cutFeatureId===proof?.cutFeatureId&&validId(proof.sourceSketchId)&&
   !seen.has(proof.sourceSketchId)&&
   typeof proof.profileCandidateId==='string'&&proof.profileCandidateId.startsWith('cycle:')&&
   tool?.protocol==='intuit3d/kernel/arc-extrude-v1'&&
   tool.revision===chain.revision&&tool.exportStep===false&&
   tool.profile?.sourceSignature===proof.sourceSignature&&tool.thicknessMm===thickness,
   'cut source identity, sketch, profile, depth or revision mismatch');
  seen.add(item.cutFeatureId);seen.add(proof.sourceSketchId);
  need(Number.isFinite(item.cutDepthMm)&&item.cutDepthMm>0&&item.cutDepthMm<=thickness,
   'cut depth outside body');
  const r=rectGeometry(tool.profile,item.cutFeatureId);
  const inLeg=Math.abs(r.x+l.width/2-l.legWidth/2)+r.width/2<l.legWidth/2&&
   Math.abs(r.y)+r.depth/2<l.depth/2;
  const inFoot=Math.abs(r.x)+r.width/2<l.width/2&&
   Math.abs(r.y+l.depth/2-l.footHeight/2)+r.depth/2<l.footHeight/2;
  need(inLeg||inFoot,'cut extends outside admitted L material');
  return {featureId:item.cutFeatureId,kind:'rectangle',...r,cutDepthMm:item.cutDepthMm};
 });
 const [a,b]=cuts;
 need(Math.abs(a.x-b.x)>(a.width+b.width)/2||
  Math.abs(a.y-b.y)>(a.depth+b.depth)/2,
  'pinned C++ refuses touching or overlapping cuts');
 const request={protocol:'intuit3d/kernel/l-profile-cut-chain-v3',
  requestId:chain.requestId,featureId:chain.targetBodyId,revision:chain.revision,
  units:'mm',exportStep:chain.exportStep,
  profile:{profileId:selection.baseSketchId,...l,thickness},cuts};
 return {format:EXPERIMENT_PROTOCOL,version:1,request,
  provenance:{projectId:selection.projectId,sourceRevision:chain.revision,
   baseExtrudeId:chain.baseExtrude.featureId,bodyId:chain.targetBodyId,
   baseSketchId:selection.baseSketchId,
   baseProfileCandidateId:selection.baseProfileCandidateId,
   baseSourceSignature:selection.baseSourceSignature,
   cutSelections:selection.cuts.map(x=>({...x})),
   nativeWireCarriesSolverGeometry:false,
   nativeWireCarriesProfileCandidateIds:false},
  state:'pending_physical',exactAuthority:false,independentInteroperability:false};
}
export function admitFreshReceipt(mapping,receipt,liveProjectId,liveRevision){
 need(mapping?.format===EXPERIMENT_PROTOCOL&&
 liveProjectId===mapping.provenance?.projectId&&
 liveRevision===mapping.request?.revision,
 'obsolete STEP receipt or different project');
 need(receipt?.kind==='experimental_report'&&
 receipt.revision===mapping.request.revision&&
 receipt.featureId===mapping.request.featureId&&
 receipt.profileId===mapping.request.profile.profileId&&
 JSON.stringify(receipt.cutFeatureIds)===
 JSON.stringify(mapping.request.cuts.map(c=>c.featureId))&&
 receipt.artifact?.sha256&&/^[0-9a-f]{64}$/.test(receipt.artifact.sha256)&&
 receipt.exactAuthority===false&&receipt.independentInteroperability===false,
 'no source-matched pinned physical receipt');
 return {kind:'experimental_physical_only',projectId:liveProjectId,
  revision:liveRevision,bodyId:mapping.request.featureId,
  sourceSignatures:[mapping.provenance.baseSourceSignature,
   ...mapping.provenance.cutSelections.map(c=>c.sourceSignature)],
  stepSha256:receipt.artifact.sha256,
  exactAuthority:false,independentInteroperability:false};
}
