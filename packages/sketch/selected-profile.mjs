import {createSketch, serializeSketch, solveSketch} from './index.mjs';
import {discoverPlateProfiles} from './profile-discovery.mjs';

/**
 * Explicit, source-replayed profile selection for sketches with multiple
 * authored line loops. Only analytic 2D data is returned; this never admits
 * native B-rep topology, geometry precision or STEP by itself.
 */
export const SELECTED_PROFILE_VERSION = 1;

function boundingBox(points) {
  return {
    minX: Math.min(...points.map(p=>p.x)), maxX: Math.max(...points.map(p=>p.x)),
    minY: Math.min(...points.map(p=>p.y)), maxY: Math.max(...points.map(p=>p.y))
  };
}
function separated(a,b) {
  // Strict positive clearance. Touch and bounding-box overlap are refused
  // conservatively; no tolerance enlargement or imagined polygon welding.
  return a.maxX < b.minX || b.maxX < a.minX ||
    a.maxY < b.minY || b.maxY < a.minY;
}

/** Source-only selected-profile admission; consumer still chooses target body. */
export function proposeSelectedPlateProfile(source,selection) {
  const doc=createSketch(source), stamp=serializeSketch(doc);
  const discovery=discoverPlateProfiles(doc);
  const refused=(reason,overlappingLineIds=[])=>({
    kind:'refused',version:1,sourceSignature:stamp,
    candidateId:selection?.candidateId??null,reason,
    overlappingLineIds,availableCandidateIds:discovery.candidates.map(c=>c.id),
    sourceStatus:discovery.sourceStatus,previewOnly:true,nativeExact:false
  });
  if (!selection || typeof selection!=='object' || Array.isArray(selection) ||
      Object.keys(selection).length!==2 ||
      !Object.hasOwn(selection,'candidateId') ||
      !Object.hasOwn(selection,'sourceSignature') ||
      typeof selection.candidateId!=='string' ||
      typeof selection.sourceSignature!=='string') return refused('invalid_selection');
  if (selection.sourceSignature!==stamp) return refused('stale_source');
  if (discovery.status!=='ready' && discovery.status!=='ambiguous')
    return refused('source_not_profile_ready');
  const candidate=discovery.candidates.find(c=>c.id===selection.candidateId);
  if (!candidate) return refused('unknown_profile');
  const solved=solveSketch(doc);
  if (solved.status!=='solved' || !solved.geometry)
    return refused('source_not_solved');
  const points=new Map(solved.geometry.points.map(p=>[p.id,p]));
  const outerBox=boundingBox(candidate.profile.outer);
  const chosen=new Set(candidate.lineIds);
  const unselectedLineIds=[],overlappingLineIds=[];
  for (const edge of doc.lines) {
    if (chosen.has(edge.id)) continue;
    unselectedLineIds.push(edge.id);
    const p1=points.get(edge.start),p2=points.get(edge.end);
    if (!p1 || !p2 || !separated(outerBox,boundingBox([p1,p2])))
      overlappingLineIds.push(edge.id);
  }
  unselectedLineIds.sort();
  overlappingLineIds.sort();
  if (overlappingLineIds.length)
    return refused('unselected_lines_contact_or_overlap_selected_bounds',overlappingLineIds);
  const lineMap=new Map(doc.lines.map(e=>[e.id,e]));
  const boundary=candidate.orderedEdges.map(({id,reversed})=>{
    const edge=lineMap.get(id);
    const startPointId=reversed?edge.end:edge.start;
    const endPointId=reversed?edge.start:edge.end;
    return {edgeId:id,startPointId,endPointId,
      start:{x:points.get(startPointId).x,y:points.get(startPointId).y},
      end:{x:points.get(endPointId).x,y:points.get(endPointId).y}};
  });
  return {
    kind:'selected_analytic_profile',version:1,sourceSignature:stamp,
    candidateId:candidate.id,semanticProfileId:candidate.id,units:'mm',
    lineIds:[...candidate.lineIds],holeIds:[...candidate.holeIds],
    unselectedLineIds, boundary, profile:structuredClone(candidate.profile),
    previewOnly:true,providerSubmissionReady:true,nativeExact:false,
    exactBrepAvailable:false,independentStepQualified:false
  };
}

/**
 * A caller may display proposals, but can only commit a profile re-derived
 * from the authoritative current sketch. Both selection and all geometry
 * are revalidated; a stale proposal or any forged field is refused.
 */
export function admitSelectedPlateProfile(source,proposal) {
  if (!proposal || typeof proposal!=='object' || Array.isArray(proposal) ||
      proposal.kind!=='selected_analytic_profile' || proposal.version!==1)
    throw new TypeError('sketch selected profile: invalid proposal');
  const fresh=proposeSelectedPlateProfile(source,{
    candidateId:proposal.candidateId,sourceSignature:proposal.sourceSignature
  });
  if (fresh.kind!=='selected_analytic_profile' ||
      JSON.stringify(fresh)!==JSON.stringify(proposal))
    throw new TypeError('sketch selected profile: stale, unsafe or modified proposal');
  return structuredClone(fresh);
}

/**
 * A real linear-constraint sketch of an L-shaped plate with two dimensioned
 * circular holes, each anchored to a feature corner. Width/height/web/flange
 * edits propagate through the solver; all IDs survive replay.
 */
export function createDimensionedLPlateSketch(options={}) {
  if (!options || typeof options!=='object' || Array.isArray(options) ||
      Object.keys(options).some(k=>![
        'lengthMm','heightMm','webWidthMm','flangeHeightMm','holeRadiusMm'
      ].includes(k))) throw new TypeError('sketch L profile: invalid options');
  const {lengthMm=120,heightMm=80,webWidthMm=40,flangeHeightMm=30,
    holeRadiusMm=5}=options;
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  if (![lengthMm,heightMm,webWidthMm,flangeHeightMm,holeRadiusMm].every(positive) ||
      webWidthMm>=lengthMm || flangeHeightMm>=heightMm)
    throw new TypeError('sketch L profile: invalid dimensions');
  const corner=[
    {id:'L:a',x:0,y:0}, {id:'L:b',x:lengthMm,y:0},
    {id:'L:c',x:lengthMm,y:flangeHeightMm},
    {id:'L:d',x:webWidthMm,y:flangeHeightMm},
    {id:'L:e',x:webWidthMm,y:heightMm},
    {id:'L:f',x:0,y:heightMm}
  ];
  const points=[...corner,
    {id:'L:holeLowerCenter',x:lengthMm-30,y:15},
    {id:'L:holeUpperCenter',x:webWidthMm-20,y:heightMm-20}];
  const lines=corner.map((p,i)=>({
    id:'L:edge'+i,start:p.id,end:corner[(i+1)%corner.length].id
  }));
  const constraints=[
    {id:'L:origin',kind:'fixed',point:'L:a',x:0,y:0},
    ...[0,2,4].map(i=>({id:'L:horizontal'+i,kind:'horizontal',line:'L:edge'+i})),
    ...[1,3,5].map(i=>({id:'L:vertical'+i,kind:'vertical',line:'L:edge'+i})),
    {id:'L:length',kind:'distanceX',a:'L:a',b:'L:b',value:lengthMm},
    {id:'L:flangeHeight',kind:'distanceY',a:'L:a',b:'L:c',value:flangeHeightMm},
    {id:'L:webWidth',kind:'distanceX',a:'L:a',b:'L:d',value:webWidthMm},
    {id:'L:height',kind:'distanceY',a:'L:a',b:'L:e',value:heightMm},
    {id:'L:holeLowerOffsetX',kind:'distanceX',a:'L:b',b:'L:holeLowerCenter',value:-30},
    {id:'L:holeLowerOffsetY',kind:'distanceY',a:'L:b',b:'L:holeLowerCenter',value:15},
    {id:'L:holeUpperOffsetX',kind:'distanceX',a:'L:e',b:'L:holeUpperCenter',value:-20},
    {id:'L:holeUpperOffsetY',kind:'distanceY',a:'L:e',b:'L:holeUpperCenter',value:-20},
    {id:'L:holeLowerRadius',kind:'radius',circle:'L:holeLower',value:holeRadiusMm},
    {id:'L:holeUpperRadius',kind:'radius',circle:'L:holeUpper',value:holeRadiusMm}
  ];
  const doc=createSketch({version:1,units:'mm',points,lines,
    circles:[
      {id:'L:holeLower',center:'L:holeLowerCenter',radius:holeRadiusMm},
      {id:'L:holeUpper',center:'L:holeUpperCenter',radius:holeRadiusMm}
    ],constraints});
  const discovered=discoverPlateProfiles(doc);
  if (discovered.status!=='ready')
    throw new TypeError('sketch L profile: dimensions do not admit a nonoverlapping solved profile');
  return doc;
}
