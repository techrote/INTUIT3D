/**
 * SKETCH arc-profile hole authoring v1.
 * Stateless immutable authoring of circular through-hole loops in a solved
 * analytic line/arc sketch. The document is authoritative; profile data is
 * derived, not an alternative CAD journal or native geometry declaration.
 */
import {createArcSketch,serializeArcSketch,solveArcSketch} from './arc-constraints.mjs';
import {prepareArcProfileForProvider} from './arc-profile.mjs';

export const ARC_HOLE_AUTHORING_VERSION = 1;
export const ARC_HOLE_SELECTION_FORMAT = 'intuit3d.arc-hole-selection';
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const validId = value => typeof value === 'string' && /^[A-Za-z][\\w:.-]{0,127}$/.test(value);
const hasExactKeys = (value,keys) => value && typeof value==='object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === keys.slice().sort().join('|');
const fail = message => {throw new TypeError('sketch arc hole authoring: '+message);};

export function createArcHoleSelection(source) {
  if(!hasExactKeys(source,['format','version','profileId','boundaryIds','holeIds']) ||
     source.format!==ARC_HOLE_SELECTION_FORMAT||source.version!==1||
     !validId(source.profileId)||
     !Array.isArray(source.boundaryIds)||source.boundaryIds.length<4||
     !Array.isArray(source.holeIds)||
     !source.boundaryIds.every(validId)||!source.holeIds.every(validId)||
     new Set(source.boundaryIds).size!==source.boundaryIds.length||
     new Set(source.holeIds).size!==source.holeIds.length)
    fail('invalid profile selection');
  return structuredClone(source);
}
export const serializeArcHoleSelection = selection =>
  JSON.stringify(createArcHoleSelection(selection));

function circleInfo(doc,circleId) {
  const circle=doc.circles.find(circle=>circle.id===circleId);
  if(!circle)return null;
  const center=doc.points.find(point=>point.id===circle.center);
  const fixed=doc.constraints.filter(c=>c.kind==='fixed'&&c.point===circle.center);
  const otherReferences=doc.constraints.some(c=>c.kind!=='fixed' &&
    ((c.point===circle.center)||(c.a===circle.center)||(c.b===circle.center))) ||
    doc.lines.some(line=>line.start===circle.center||line.end===circle.center) ||
    doc.arcs.some(arc=>arc.start===circle.center||arc.end===circle.center||arc.center===circle.center) ||
    doc.circles.some(other=>other.id!==circleId&&other.center===circle.center);
  return {circle,center,fixed,otherReferences};
}

/** Stable semantic handles, suitable for a real browser inspector or pointer drag. */
export function inspectArcHoleControls(source,selectionSource) {
  const doc=createArcSketch(source),selection=createArcHoleSelection(selectionSource);
  const controls=selection.holeIds.map(circleId=>{
    const info=circleInfo(doc,circleId);
    if(!info)fail('selected circle missing: '+circleId);
    return {
      id:circleId,centerPointId:info.circle.center,
      centerConstraintId:info.fixed.length===1?info.fixed[0].id:null,
      xMm:info.center.x,yMm:info.center.y,
      diameterMm:2*info.circle.radiusMm,
      canMove:info.fixed.length===1&&!info.otherReferences,
      canResize:true
    };
  });
  return {version:1,profileId:selection.profileId,
    sourceSignature:serializeArcSketch(doc),
    selectionSignature:serializeArcHoleSelection(selection),controls};
}

const requestKeys={
  add:['kind','circleId','xMm','yMm','diameterMm'],
  move:['kind','circleId','xMm','yMm'],
  resize:['kind','circleId','diameterMm'],
  remove:['kind','circleId']
};

/**
 * Atomically propose one authored change and validate the resulting solved
 * analytic profile. Rejections retain the caller's document and selection;
 * the owning INTENT/RUNTIME journal decides whether to commit an acceptance.
 * Neither status nor profileSubmittable indicates native B-rep/STEP exactness.
 */
export function editArcProfileHole(source,selectionSource,change,expected) {
  const doc=createArcSketch(source),selection=createArcHoleSelection(selectionSource);
  const sourceSignature=serializeArcSketch(doc);
  const selectionSignature=serializeArcHoleSelection(selection);
  const refuse=reason=>({kind:'refused',version:1,reason,
    sourceSignature,selectionSignature});
  if(!hasExactKeys(expected,['sourceSignature','selectionSignature']) ||
     expected.sourceSignature!==sourceSignature ||
     expected.selectionSignature!==selectionSignature)
    return refuse('stale document or profile selection');
  if(!change||!requestKeys[change.kind]||
     !hasExactKeys(change,requestKeys[change.kind])||!validId(change.circleId))
    return refuse('invalid authored hole command');
  const next=structuredClone(doc),updated=structuredClone(selection);
  const existing=circleInfo(doc,change.circleId);
  if(change.kind==='add'){
    if(!isFiniteNumber(change.xMm)||!isFiniteNumber(change.yMm)||
       !isFiniteNumber(change.diameterMm)||change.diameterMm<=0 ||
       !isFiniteNumber(change.diameterMm/2)||change.diameterMm/2<=0)
      return refuse('invalid hole dimensions');
    if(existing)return refuse('hole ID already authored');
    const pointId='hole.'+change.circleId+'.center';
    const constraintId='hole.'+change.circleId+'.fixed';
    const used=new Set([...doc.points,...doc.lines,...doc.arcs,...doc.circles,...doc.constraints].map(e=>e.id));
    if(!validId(pointId)||!validId(constraintId)||
       [change.circleId,pointId,constraintId].some(id=>used.has(id)))
      return refuse('hole semantic identity collision');
    next.points.push({id:pointId,x:change.xMm,y:change.yMm});
    next.circles.push({id:change.circleId,center:pointId,radiusMm:change.diameterMm/2});
    next.constraints.push({id:constraintId,kind:'fixed',point:pointId,x:change.xMm,y:change.yMm});
    updated.holeIds.push(change.circleId);
  }else{
    if(!existing||!selection.holeIds.includes(change.circleId))
      return refuse('hole is not in the selected profile');
    if(change.kind==='move'){
      if(!isFiniteNumber(change.xMm)||!isFiniteNumber(change.yMm))
        return refuse('invalid centre coordinates');
      if(existing.fixed.length!==1||existing.otherReferences)
        return refuse('centre is not independently editable by one fixed dimension');
      const center=next.points.find(p=>p.id===existing.circle.center);
      const dimension=next.constraints.find(c=>c.id===existing.fixed[0].id);
      center.x=change.xMm;center.y=change.yMm;
      dimension.x=change.xMm;dimension.y=change.yMm;
    }else if(change.kind==='resize'){
      if(!isFiniteNumber(change.diameterMm)||change.diameterMm<=0||
         !isFiniteNumber(change.diameterMm/2)||change.diameterMm/2<=0)
        return refuse('invalid hole diameter');
      next.circles.find(c=>c.id===change.circleId).radiusMm=change.diameterMm/2;
    }else if(change.kind==='remove'){
      if(existing.otherReferences)return refuse('hole centre is referenced by other authored geometry');
      next.circles=next.circles.filter(c=>c.id!==change.circleId);
      next.points=next.points.filter(p=>p.id!==existing.circle.center);
      next.constraints=next.constraints.filter(c=>!(c.kind==='fixed'&&c.point===existing.circle.center));
      updated.holeIds=updated.holeIds.filter(id=>id!==change.circleId);
    }
  }
  try {
    const sketch=createArcSketch(next);
    const selectionNext=createArcHoleSelection(updated);
    const solved=solveArcSketch(sketch);
    if(solved.status!=='solved')
      return refuse('resulting sketch is '+solved.status+': '+JSON.stringify(solved.diagnostics));
    const profile=prepareArcProfileForProvider(sketch,solved,{
      profileId:selectionNext.profileId,
      boundaryIds:selectionNext.boundaryIds,holeIds:selectionNext.holeIds
    });
    return {kind:'accepted',version:1,sketch,selection:selectionNext,
      solution:solved,profile,sourceSignature:serializeArcSketch(sketch),
      selectionSignature:serializeArcHoleSelection(selectionNext)};
  }catch(error){
    return refuse('resulting analytic profile rejected: '+String(error?.message||error));
  }
}
