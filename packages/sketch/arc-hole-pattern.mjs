/**
 * Associative rectangular hole-pattern proposals over authoritative SKETCH
 * arc geometry. The pattern is an authored, persistable *parameter record*,
 * not a second solver, journal, topology index, B-rep, or browser cache.
 *
 * Every accepted change produces one complete immutable sketch+selection+
 * pattern candidate for one INTENT/RUNTIME transaction. The existing
 * nonlinear solver and analytic profile validator run on the final shape.
 */
import {createArcSketch,serializeArcSketch,solveArcSketch} from './arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection} from './arc-hole-authoring.mjs';
import {prepareArcProfileForProvider} from './arc-profile.mjs';

export const ARC_HOLE_PATTERN_VERSION=1;
export const ARC_HOLE_PATTERN_FORMAT='intuit3d.arc-hole-pattern';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validId=id=>typeof id==='string'&&/^[A-Za-z][\w:.-]{0,127}$/.test(id);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
const fail=message=>{throw new TypeError('arc hole pattern: '+message);};
const metadataKeys=['format','version','id','sourceCircleId','rows','columns',
  'spacingXmm','spacingYmm','seedSnapshot'];
const settingsKeys=['id','sourceCircleId','rows','columns','spacingXmm','spacingYmm'];
const expectedKeys=['sourceSignature','selectionSignature','patternSignature'];
const sourceStamp=(doc,selection,pattern)=>({
  sourceSignature:serializeArcSketch(doc),
  selectionSignature:serializeArcHoleSelection(selection),
  patternSignature:pattern?serializeArcHolePattern(pattern):null
});
const selectionRequest=s=>({profileId:s.profileId,boundaryIds:s.boundaryIds,holeIds:s.holeIds});

function validateSettings(value,allowSingle=false){
  if(!exact(value,settingsKeys)||!validId(value.id)||!validId(value.sourceCircleId)||
     !Number.isSafeInteger(value.rows)||!Number.isSafeInteger(value.columns)||
     value.rows<1||value.columns<1||value.rows>8||value.columns>8||
     value.rows*value.columns>12||(!allowSingle&&value.rows*value.columns<2)||
     !finite(value.spacingXmm)||!finite(value.spacingYmm))
    fail('invalid pattern dimensions or semantic IDs');
  for(const member of members(value)){
    if(!validId(member.id)||!validId('hole.'+member.id+'.center')||
       !validId('hole.'+member.id+'.fixed'))
      fail('derived semantic ID would exceed supported length');
  }
  return structuredClone(value);
}
function members(pattern){
  const list=[];
  for(let r=0;r<pattern.rows;r++)for(let c=0;c<pattern.columns;c++){
    if(r===0&&c===0)continue;
    list.push({id:pattern.id+':r'+r+'c'+c,row:r,column:c});
  }
  return list;
}
export function createArcHolePattern(source){
  if(!exact(source,metadataKeys)||source.format!==ARC_HOLE_PATTERN_FORMAT||
     source.version!==ARC_HOLE_PATTERN_VERSION||
     !exact(source.seedSnapshot,['xMm','yMm','radiusMm'])||
     !finite(source.seedSnapshot.xMm)||!finite(source.seedSnapshot.yMm)||
     !finite(source.seedSnapshot.radiusMm)||source.seedSnapshot.radiusMm<=0)
    fail('invalid versioned pattern record');
  validateSettings(Object.fromEntries(settingsKeys.map(k=>[k,source[k]])),true);
  return structuredClone(source);
}
export const serializeArcHolePattern=pattern=>JSON.stringify(createArcHolePattern(pattern));
export const parseArcHolePattern=json=>createArcHolePattern(JSON.parse(json));

function solvedSeed(doc,solution,circleId){
  const circle=doc.circles.find(c=>c.id===circleId);
  if(!circle)fail('source circle is missing');
  const center=solution.geometry?.points.find(p=>p.id===circle.center);
  if(!center||!finite(center.x)||!finite(center.y)||
     !finite(circle.radiusMm)||circle.radiusMm<=0)
    fail('source circle has no solved finite centre and positive radius');
  return {xMm:center.x,yMm:center.y,radiusMm:circle.radiusMm};
}
function assertMember(doc,selection,pattern,member){
  const circle=doc.circles.find(c=>c.id===member.id);
  const pointId='hole.'+member.id+'.center',fixedId='hole.'+member.id+'.fixed';
  const point=doc.points.find(p=>p.id===pointId);
  const fixed=doc.constraints.find(c=>c.id===fixedId);
  const x=pattern.seedSnapshot.xMm+member.column*pattern.spacingXmm;
  const y=pattern.seedSnapshot.yMm+member.row*pattern.spacingYmm;
  if(!circle||!point||!fixed||!selection.holeIds.includes(member.id)||
     circle.center!==pointId||circle.radiusMm!==pattern.seedSnapshot.radiusMm||
     point.x!==x||point.y!==y||fixed.kind!=='fixed'||
     fixed.point!==pointId||fixed.x!==x||fixed.y!==y)
    fail('pattern member changed or missing: '+member.id);
  const otherReferences=doc.constraints.some(c=>c.id!==fixedId&&
     (c.point===pointId||c.a===pointId||c.b===pointId))||
    doc.lines.some(l=>l.start===pointId||l.end===pointId)||
    doc.arcs.some(a=>a.start===pointId||a.end===pointId||a.center===pointId)||
    doc.circles.some(c=>c.id!==member.id&&c.center===pointId);
  if(otherReferences)fail('pattern member has other authored dependencies: '+member.id);
}
function verifyMembers(doc,selection,pattern){
  for(const member of members(pattern))assertMember(doc,selection,pattern,member);
}
function profileFor(doc,selection){
  const solution=solveArcSketch(doc);
  if(solution.status!=='solved')fail('sketch '+solution.status+
    ': '+JSON.stringify(solution.diagnostics));
  return {solution,profile:prepareArcProfileForProvider(doc,solution,selectionRequest(selection))};
}
function validateExpectation(doc,selection,pattern,expected){
  const stamp=sourceStamp(doc,selection,pattern);
  if(!exact(expected,expectedKeys)||
     expected.sourceSignature!==stamp.sourceSignature||
     expected.selectionSignature!==stamp.selectionSignature||
     expected.patternSignature!==stamp.patternSignature)
    fail('stale sketch, profile selection, or pattern parameters');
  return stamp;
}
function seedEditable(doc,circleId){
  const circle=doc.circles.find(c=>c.id===circleId);
  const fixed=doc.constraints.filter(c=>c.kind==='fixed'&&c.point===circle?.center);
  const point=doc.points.find(p=>p.id===circle?.center);
  if(!circle||!point||fixed.length!==1||
     doc.constraints.some(c=>c.kind!=='fixed'&&
       (c.point===circle.center||c.a===circle.center||c.b===circle.center))||
     doc.lines.some(l=>l.start===circle.center||l.end===circle.center)||
     doc.arcs.some(a=>a.start===circle.center||a.end===circle.center||a.center===circle.center)||
     doc.circles.some(c=>c.id!==circleId&&c.center===circle.center))
    fail('source hole centre has other authored dependencies');
  return {circle,point,fixed:fixed[0]};
}
function buildRecord(settings,seed){
  return createArcHolePattern({format:ARC_HOLE_PATTERN_FORMAT,
    version:ARC_HOLE_PATTERN_VERSION,...settings,seedSnapshot:seed});
}

/** Inspect persisted relationships; an externally edited seed is a refreshable
 * out-of-sync state, while manually edited pattern members fail closed. */
export function inspectArcHolePattern(source,selected,patternSource){
  const doc=createArcSketch(source),selection=createArcHoleSelection(selected);
  const pattern=createArcHolePattern(patternSource),stamp=sourceStamp(doc,selection,pattern);
  const result={format:ARC_HOLE_PATTERN_FORMAT,version:1,...stamp,
    pattern,memberIds:members(pattern).map(m=>m.id),
    status:'unresolved',reason:null,profile:null,previewOnly:true,nativeExact:false};
  try{
    verifyMembers(doc,selection,pattern);
    if(!selection.holeIds.includes(pattern.sourceCircleId))
      fail('source hole is no longer in selected profile');
    const {solution,profile}=profileFor(doc,selection);
    result.profile=profile;
    const seed=solvedSeed(doc,solution,pattern.sourceCircleId);
    result.status=seed.xMm===pattern.seedSnapshot.xMm&&
      seed.yMm===pattern.seedSnapshot.yMm&&
      seed.radiusMm===pattern.seedSnapshot.radiusMm?'synchronized':'seed_changed';
    if(result.status==='seed_changed')
      result.reason='source hole changed; refresh pattern to update dependent holes';
  }catch(error){
    result.reason=String(error?.message||error);
  }
  return result;
}

/**
 * One journal-neutral edit; caller must atomically commit the three returned
 * values or none. A copy with manual edits is never silently overwritten.
 * Supported commands:
 * create {kind,id,sourceCircleId,rows,columns,spacingXmm,spacingYmm}
 * reconfigure {kind,rows,columns,spacingXmm,spacingYmm}
 * refresh {kind}
 * edit-seed {kind,xMm,yMm,diameterMm}
 */
export function proposeArcHolePattern(source,selected,existing,command,expected){
  const doc=createArcSketch(source),selection=createArcHoleSelection(selected);
  const pattern=existing===null?null:createArcHolePattern(existing);
  const stamp=sourceStamp(doc,selection,pattern);
  const refuse=reason=>({kind:'refused',format:ARC_HOLE_PATTERN_FORMAT,
    version:1,...stamp,reason,previewOnly:true});
  try{
    validateExpectation(doc,selection,pattern,expected);
    if(!command||typeof command!=='object'||Array.isArray(command))
      fail('invalid pattern command');
    let settings;
    if(pattern===null){
      if(!exact(command,['kind',...settingsKeys])||command.kind!=='create')
        fail('create command required for new pattern');
      settings=validateSettings(Object.fromEntries(settingsKeys.map(k=>[k,command[k]])));
    }else{
      verifyMembers(doc,selection,pattern);
      if(command.kind==='reconfigure'&&
         exact(command,['kind','rows','columns','spacingXmm','spacingYmm'])){
        settings=validateSettings({...Object.fromEntries(
          settingsKeys.map(k=>[k,pattern[k]])),...command,kind:undefined},true);
      }else if(command.kind==='refresh'&&exact(command,['kind'])){
        settings=Object.fromEntries(settingsKeys.map(k=>[k,pattern[k]]));
      }else if(command.kind==='edit-seed'&&
        exact(command,['kind','xMm','yMm','diameterMm'])){
        settings=Object.fromEntries(settingsKeys.map(k=>[k,pattern[k]]));
      }else fail('invalid pattern edit command');
    }
    if(!selection.holeIds.includes(settings.sourceCircleId))
      fail('source circle must belong to selected analytic profile');
    // Reconfigure must not embed a transient command discriminator in the
    // persisted settings object.
    if('kind' in settings)delete settings.kind;
    const next=structuredClone(doc),nextSelection=structuredClone(selection);
    if(command.kind==='edit-seed'){
      if(!finite(command.xMm)||!finite(command.yMm)||
         !finite(command.diameterMm)||command.diameterMm<=0||
         !finite(command.diameterMm/2)||command.diameterMm/2<=0)
        fail('invalid source hole position or diameter');
      const edit=seedEditable(next,settings.sourceCircleId);
      edit.point.x=command.xMm;edit.point.y=command.yMm;
      edit.fixed.x=command.xMm;edit.fixed.y=command.yMm;
      edit.circle.radiusMm=command.diameterMm/2;
    }
    // An invalid existing sketch cannot be used as an assumed source of
    // physical geometry. The final combined solve may still repair a
    // temporarily out-of-sync seed; no interim candidate is committed.
    const seedSolution=solveArcSketch(next);
    if(seedSolution.status!=='solved')fail('source sketch '+seedSolution.status);
    const seed=solvedSeed(next,seedSolution,settings.sourceCircleId);
    const old=pattern?members(pattern):[];
    const desired=members(settings);
    const oldMap=new Map(old.map(m=>[m.id,m]));
    const desiredIds=new Set(desired.map(m=>m.id));
    const removedIds=old.filter(m=>!desiredIds.has(m.id)).map(m=>m.id);
    const preservedIds=desired.filter(m=>oldMap.has(m.id)).map(m=>m.id);
    const createdIds=desired.filter(m=>!oldMap.has(m.id)).map(m=>m.id);
    const occupied=new Set([...next.points,...next.lines,...next.arcs,
      ...next.circles,...next.constraints].map(e=>e.id));
    for(const member of desired){
      const pointId='hole.'+member.id+'.center',fixedId='hole.'+member.id+'.fixed';
      if(!oldMap.has(member.id)&&
         [member.id,pointId,fixedId].some(id=>occupied.has(id)))
        fail('pattern semantic identity collision: '+member.id);
      if(!oldMap.has(member.id))
        [member.id,pointId,fixedId].forEach(id=>occupied.add(id));
    }
    const removed=new Set(removedIds);
    next.circles=next.circles.filter(c=>!removed.has(c.id));
    next.points=next.points.filter(p=>!removedIds.some(id=>p.id==='hole.'+id+'.center'));
    next.constraints=next.constraints.filter(c=>!removedIds.some(id=>c.id==='hole.'+id+'.fixed'));
    nextSelection.holeIds=nextSelection.holeIds.filter(id=>!removed.has(id));
    for(const member of desired){
      const x=seed.xMm+member.column*settings.spacingXmm;
      const y=seed.yMm+member.row*settings.spacingYmm;
      if(!finite(x)||!finite(y))fail('pattern placement overflow');
      const pointId='hole.'+member.id+'.center',fixedId='hole.'+member.id+'.fixed';
      if(oldMap.has(member.id)){
        const circle=next.circles.find(c=>c.id===member.id);
        const point=next.points.find(p=>p.id===pointId);
        const fixed=next.constraints.find(c=>c.id===fixedId);
        circle.radiusMm=seed.radiusMm;point.x=x;point.y=y;fixed.x=x;fixed.y=y;
      }else{
        next.points.push({id:pointId,x,y});
        next.circles.push({id:member.id,center:pointId,radiusMm:seed.radiusMm});
        next.constraints.push({id:fixedId,kind:'fixed',point:pointId,x,y});
        nextSelection.holeIds.push(member.id);
      }
    }
    const sketch=createArcSketch(next),selectionAfter=createArcHoleSelection(nextSelection);
    const {solution,profile}=profileFor(sketch,selectionAfter);
    const record=buildRecord(settings,seed);
    return {kind:'accepted',format:ARC_HOLE_PATTERN_FORMAT,version:1,
      previous:stamp,...sourceStamp(sketch,selectionAfter,record),
      sketch,selection:selectionAfter,pattern:record,solution,profile,
      createdIds,removedIds,preservedIds,previewOnly:true,nativeExact:false};
  }catch(error){return refuse(String(error?.message||error));}
}

/** Upgrade an existing one-shot arc-profile-tools array without changing
 * sketch geometry. Admission requires matching expected copies and identities. */
export function adoptArcHolePattern(source,selected,request,expected){
  const doc=createArcSketch(source),selection=createArcHoleSelection(selected);
  const stamp=sourceStamp(doc,selection,null);
  const refuse=reason=>({kind:'refused',format:ARC_HOLE_PATTERN_FORMAT,
    version:1,...stamp,reason,previewOnly:true});
  try{
    validateExpectation(doc,selection,null,expected);
    const settings=validateSettings(request);
    if(!selection.holeIds.includes(settings.sourceCircleId))
      fail('source circle is not in selected profile');
    const {solution,profile}=profileFor(doc,selection);
    const record=buildRecord(settings,solvedSeed(doc,solution,settings.sourceCircleId));
    verifyMembers(doc,selection,record);
    return {kind:'accepted',format:ARC_HOLE_PATTERN_FORMAT,version:1,
      previous:stamp,...sourceStamp(doc,selection,record),
      sketch:doc,selection,pattern:record,solution,profile,
      createdIds:[],removedIds:[],preservedIds:members(record).map(m=>m.id),
      previewOnly:true,nativeExact:false};
  }catch(error){return refuse(String(error?.message||error));}
}
