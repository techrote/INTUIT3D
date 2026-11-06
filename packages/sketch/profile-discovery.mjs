import {validateSketch, serializeSketch, solveSketch, buildPlateProfile} from './index.mjs';
import {assessCircularProfile} from './circle-guard.mjs';

/**
 * Deterministic profile inference for v1 *linear* sketch geometry.
 * Neither an exact polygon predicate nor an automatic B-rep authoring action.
 * Endpoints are joined by semantic point ID, never by coordinate proximity.
 */
export const PROFILE_DISCOVERY_VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({maxLines:256,maxCircles:64,maxCandidates:16});
const HARD_LIMITS = Object.freeze({maxLines:512,maxCircles:128,maxCandidates:64});
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const validNumber = x => typeof x==='number' && Number.isFinite(x);

function validateOptions(options) {
  if (!options || typeof options!=='object' || Array.isArray(options) ||
      Object.keys(options).some(k=>!Object.hasOwn(DEFAULT_LIMITS,k))) {
    throw new TypeError('sketch profile discovery: invalid options');
  }
  const limits={...DEFAULT_LIMITS,...options};
  for (const [k,n] of Object.entries(limits)) if (!Number.isSafeInteger(n) || n<1 || n>HARD_LIMITS[k]) {
    throw new TypeError('sketch profile discovery: invalid '+k);
  }
  return limits;
}

/** Topological components are keyed by authored references; no geometric welding. */
function lineComponents(lines) {
  const adjacency=new Map();
  const byId=new Map(lines.map(e=>[e.id,e]));
  for (const edge of lines) for (const point of [edge.start,edge.end]) {
    if (!adjacency.has(point)) adjacency.set(point,[]);
    adjacency.get(point).push(edge);
  }
  for (const edges of adjacency.values()) edges.sort((a,b)=>compare(a.id,b.id));
  const unseen=new Set(lines.map(l=>l.id));
  const components=[];
  for (const first of [...unseen].sort(compare)) {
    if (!unseen.has(first)) continue;
    const queue=[byId.get(first)], component=[];
    unseen.delete(first);
    for (let i=0;i<queue.length;i++) {
      const edge=queue[i];
      component.push(edge);
      for (const point of [edge.start,edge.end]) for (const next of adjacency.get(point)) {
        if (!unseen.delete(next.id)) continue;
        queue.push(next);
      }
    }
    components.push(component.sort((a,b)=>compare(a.id,b.id)));
  }
  return components;
}

function orderedCycle(component) {
  const adjacency=new Map();
  for (const edge of component) for (const p of [edge.start,edge.end]) {
    if (!adjacency.has(p)) adjacency.set(p,[]);
    adjacency.get(p).push(edge);
  }
  if (component.length<3 || [...adjacency.values()].some(edges=>edges.length!==2)) {
    return {error:'open_or_branching_component'};
  }
  const start=[...adjacency.keys()].sort(compare)[0], ordered=[], seen=new Set();
  let current=start, previous=null;
  for (let i=0;i<component.length;i++) {
    const edges=adjacency.get(current).filter(e=>e.id!==previous).sort((a,b)=>compare(a.id,b.id));
    const edge=edges[0];
    if (!edge || seen.has(edge.id)) return {error:'repeated_cycle_edge'};
    const reversed=edge.end===current;
    const next=reversed?edge.start:edge.end;
    ordered.push({id:edge.id,reversed,start:current,end:next});
    seen.add(edge.id); previous=edge.id; current=next;
    if (current===start && i!==component.length-1) return {error:'premature_cycle_closure'};
  }
  if (current!==start || seen.size!==component.length ||
      new Set(ordered.map(e=>e.start)).size!==ordered.length) return {error:'non_simple_cycle'};
  return {ordered};
}

function pointInside(p,vertices) {
  let inside=false;
  for (let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
    const a=vertices[i],b=vertices[j];
    if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

function distanceToBoundary(p,vertices) {
  let min=Infinity;
  for (let i=0;i<vertices.length;i++) {
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    const dx=b.x-a.x,dy=b.y-a.y,denominator=dx*dx+dy*dy;
    if (!validNumber(denominator) || denominator<=0) return null;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/denominator));
    const d=Math.hypot(a.x+t*dx-p.x,a.y+t*dy-p.y);
    if (!validNumber(d)) return null;
    min=Math.min(min,d);
  }
  return min;
}

/**
 * Finds unordered line loops and circular through-hole candidates, but does
 * not infer nesting, constraints or body selection. Ambiguity is preserved.
 * @param {import('./index.d.mts').SketchDocument} source
 * @param {{maxLines?:number,maxCircles?:number,maxCandidates?:number}} [options]
 */
export function discoverPlateProfiles(source,options={}) {
  const doc=validateSketch(source), limits=validateOptions(options);
  const inputSignature=serializeSketch(doc);
  const base={version:PROFILE_DISCOVERY_VERSION,previewOnly:true,inputSignature};
  const finish=(status,sourceStatus,reason=null,candidates=[],rejected=[])=>
    ({...base,status,sourceStatus,reason,candidates,rejected});
  if (doc.lines.length>limits.maxLines || doc.circles.length>limits.maxCircles) {
    return finish('budget_exceeded',null,'entity_count');
  }
  // Avoid executing an unbounded dense solver on sketches far beyond the
  // original bounded solver's deliberately small research envelope.
  if (2*doc.points.length+doc.circles.length>512 || doc.constraints.length>512) {
    return finish('budget_exceeded',null,'solver_size');
  }
  const components=lineComponents(doc.lines);
  if (components.length>limits.maxCandidates) return finish('budget_exceeded',null,'candidate_count');
  const solved=solveSketch(doc);
  if (solved.status==='numerical_failure') return finish('numerical_failure',solved.status,'source_numerical_failure');
  if (solved.status!=='solved' || !solved.geometry) return finish('source_unsolved',solved.status,'fully_constrained_solution_required');
  const points=new Map(solved.geometry.points.map(p=>[p.id,p]));
  const candidates=[],rejected=[];
  for (const component of components) {
    const lineIds=component.map(l=>l.id);
    const id='cycle:'+lineIds.join('|');
    const path=orderedCycle(component);
    if (!path.ordered) {
      rejected.push({id,lineIds,reason:path.error,detail:null});
      continue;
    }
    const ordered=path.ordered;
    const oriented=structuredClone(doc);
    const byId=new Map(ordered.map(e=>[e.id,e]));
    for (const line of oriented.lines) {
      const direction=byId.get(line.id);
      if (direction) {line.start=direction.start;line.end=direction.end;}
    }
    // Orientation of a segment is immaterial to the v1 horizontal/vertical
    // constraints, but the existing profile validator requires directed order.
    const orientedSolution=solveSketch(oriented);
    if (orientedSolution.status!=='solved' || !orientedSolution.geometry) {
      rejected.push({id,lineIds,reason:'orientation_replay_failed',detail:orientedSolution.status});
      continue;
    }
    const polygon=ordered.map(e=>points.get(e.start));
    const circular = assessCircularProfile(polygon,solved.geometry.circles.map(circle => {
      const center=points.get(circle.center);
      return {id:circle.id,x:center.x,y:center.y,radius:circle.radius};
    }));
    if (circular.status !== 'verified') {
      rejected.push({id,lineIds,reason:'ambiguous_circle_contact',detail:circular.reason});
      continue;
    }
    const holeIds=circular.insideIds;
    try {
      // Reuse the existing independently re-solved analytic-profile gate,
      // including self-intersection, circle overlap and finite-area checks.
      const profile=buildPlateProfile(oriented,orientedSolution,ordered.map(e=>e.id),holeIds);
      candidates.push({id,lineIds,orderedEdges:ordered.map(({id,reversed})=>({id,reversed})),holeIds,profile});
    } catch(error) {
      rejected.push({id,lineIds,reason:'profile_validation_failed',
        detail:error instanceof Error?error.message:'unknown_validation_failure'});
    }
  }
  candidates.sort((a,b)=>compare(a.id,b.id));
  rejected.sort((a,b)=>compare(a.id,b.id));
  if (!candidates.length) return finish('no_profile',solved.status,'no_valid_closed_profile',[],rejected);
  if (candidates.length!==1 || rejected.length) return finish('ambiguous',solved.status,'explicit_selection_or_repair_required',candidates,rejected);
  return finish('ready',solved.status,null,candidates,[]);
}

/**
 * A preview cannot be promoted by trusting a caller-supplied profile or stamp.
 * Recompute it from the authoritative sketch and reject modified/stale data.
 * No kernel/exact geometry claim is made.
 * @param {import('./index.d.mts').SketchDocument} source
 * @param {import('./profile-discovery.d.mts').ProfileDiscoveryResponse} proposal
 * @param {string} candidateId
 */
export function admitDiscoveredPlateProfile(source,proposal,candidateId) {
  if (!proposal || typeof proposal!=='object' || Array.isArray(proposal) ||
      typeof candidateId!=='string') throw new TypeError('sketch profile discovery: invalid admission');
  const fresh=discoverPlateProfiles(source);
  if (fresh.status!=='ready' || JSON.stringify(fresh)!==JSON.stringify(proposal)) {
    throw new TypeError('sketch profile discovery: stale, ambiguous or modified proposal');
  }
  const candidate=fresh.candidates.find(c=>c.id===candidateId);
  if (!candidate) throw new TypeError('sketch profile discovery: unknown candidate');
  return structuredClone(candidate.profile);
}
