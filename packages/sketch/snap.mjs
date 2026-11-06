import {validateSketch,serializeSketch,solveSketch} from './index.mjs';
import {evaluateSnapGeometry} from './snap-core.mjs';

/** Interactive inference only: NEVER an applied constraint or validated exact profile. */
export const SKETCH_SNAP_VERSION=1;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fail=why=>{throw new TypeError('sketch snap: '+why);};

/**
 * Return deterministic nearest point/curve/grid references on the currently
 * solved sketch. Unsolved or numerically unsafe sources produce no candidates.
 * The cursor, solved geometry and ranked candidates are transient previews.
 * @param {import('./index.d.mts').SketchDocument} source
 * @param {{x:number,y:number}} cursor
 * @param {{radiusMm?:number,maxCandidates?:number,maxEntities?:number,gridMm?:number,excludeIds?:string[]}} [options]
 */
export function suggestSketchSnaps(source,cursor,options={}){
  const doc=validateSketch(source);
  if(!cursor||typeof cursor!=='object'||Array.isArray(cursor)||
     Object.keys(cursor).sort().join(',')!=='x,y'||!finite(cursor.x)||!finite(cursor.y))fail('finite x/y cursor required');
  if(!options||typeof options!=='object'||Array.isArray(options)||
    Object.keys(options).some(k=>!['radiusMm','maxCandidates','maxEntities','gridMm','excludeIds'].includes(k)))fail('invalid options');
  const normalized={radiusMm:2,maxCandidates:16,maxEntities:4096,excludeIds:[],...options};
  if(!finite(normalized.radiusMm)||normalized.radiusMm<=0||normalized.radiusMm>1e9)fail('invalid radiusMm');
  if(!Number.isSafeInteger(normalized.maxCandidates)||normalized.maxCandidates<1||normalized.maxCandidates>64)fail('invalid maxCandidates');
  if(!Number.isSafeInteger(normalized.maxEntities)||normalized.maxEntities<1||normalized.maxEntities>4096)fail('invalid maxEntities');
  if(normalized.gridMm!==undefined&&(!finite(normalized.gridMm)||normalized.gridMm<=0||normalized.gridMm>1e9))fail('invalid gridMm');
  const all=new Set([...doc.points,...doc.lines,...doc.circles].map(x=>x.id));
  if(!Array.isArray(normalized.excludeIds)||normalized.excludeIds.some(id=>typeof id!=='string'||!all.has(id))||
    new Set(normalized.excludeIds).size!==normalized.excludeIds.length)fail('invalid excludeIds');
  const base={version:SKETCH_SNAP_VERSION,previewOnly:true,inputSignature:serializeSketch(doc),
    cursor:{x:cursor.x,y:cursor.y},sourceStatus:null,provisionalGeometry:false};
  if(all.size>normalized.maxEntities)return {...base,status:'budget_exceeded',reason:'entity_count',candidates:[],selected:null};
  const solution=solveSketch(doc);
  const header={...base,sourceStatus:solution.status,provisionalGeometry:solution.status==='underconstrained'};
  if(!solution.geometry || !['solved','underconstrained'].includes(solution.status))
    return {...header,status:'source_unsolved',reason:solution.status,candidates:[],selected:null};
  const evaluated=evaluateSnapGeometry(solution.geometry,cursor,normalized);
  return {...header,...evaluated};
}
