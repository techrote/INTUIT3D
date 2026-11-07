/**
 * Interaction-ready, journal-neutral controls for actual nonlinear line/arc
 * sketches. A caller commits only an accepted immutable document+selection
 * through INTENT/RUNTIME, once per user gesture; no parallel history authority.
 * Analytic profile validation is NOT native OCCT B-rep or STEP qualification.
 */
import {createArcSketch,serializeArcSketch,editArcConstraint,solveArcSketch}
  from './arc-constraints.mjs';
import {prepareArcProfileForProvider} from './arc-profile.mjs';
import {createArcHoleSelection,serializeArcHoleSelection,inspectArcHoleControls,
  editArcProfileHole} from './arc-hole-authoring.mjs';

export const ARC_PROFILE_TOOLS_VERSION=1;
export const ARC_PROFILE_TOOLS_FORMAT='intuit3d.arc-profile-tools';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const validId=value=>typeof value==='string'&&/^[A-Za-z][\w:.-]{0,127}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
const selectionRequest=selection=>({profileId:selection.profileId,
  boundaryIds:selection.boundaryIds,holeIds:selection.holeIds});
const signatures=(doc,selection)=>({
  sourceSignature:serializeArcSketch(doc),
  selectionSignature:serializeArcHoleSelection(selection)
});
const pointMap=(doc,solved)=>new Map((solved.geometry?.points||doc.points).map(p=>[p.id,p]));

/**
 * Works on solved AND temporarily conflicting/underconstrained documents.
 * Inspectors must retain dimension controls when a bad edit needs recovery.
 */
export function inspectArcProfileTools(source,selected) {
  const doc=createArcSketch(source),selection=createArcHoleSelection(selected);
  const stamp=signatures(doc,selection);
  const solved=solveArcSketch(doc),points=pointMap(doc,solved);
  const arcs=new Map(doc.arcs.map(arc=>[arc.id,arc]));
  const controls=[];
  for(const c of doc.constraints) {
    if(!['distanceX','distanceY','arcRadius'].includes(c.kind))continue;
    let position;
    if(c.kind==='arcRadius'){
      const arc=arcs.get(c.arc),end=points.get(arc.start);
      position={x:end.x,y:end.y};
    }else{
      const a=points.get(c.a),b=points.get(c.b);
      position={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    }
    controls.push({kind:'dimension',id:'dimension:'+c.id,
      constraintId:c.id,dimensionKind:c.kind,valueMm:c.value,position});
  }
  for(const h of inspectArcHoleControls(doc,selection).controls){
    controls.push({kind:'hole_center',id:'hole-center:'+h.id,circleId:h.id,
      position:{x:h.xMm,y:h.yMm},canMove:h.canMove});
    controls.push({kind:'hole_diameter',id:'hole-diameter:'+h.id,
      circleId:h.id,valueMm:h.diameterMm,
      position:{x:h.xMm+h.diameterMm/2,y:h.yMm}});
  }
  let profile=null,profileError=null;
  if(solved.status==='solved'){
    try{profile=prepareArcProfileForProvider(doc,solved,selectionRequest(selection));}
    catch(error){profileError=String(error?.message||error);}
  }
  return {format:ARC_PROFILE_TOOLS_FORMAT,version:1,...stamp,
    status:profileError?'profile_rejected':solved.status,
    diagnostics:solved.diagnostics,profileError,
    controls,profile,previewOnly:true};
}

function evaluate(doc,selection,createdIds=[],appliedValueMm=null){
  const sketch=createArcSketch(doc),selected=createArcHoleSelection(selection);
  const solved=solveArcSketch(sketch);
  if(solved.status!=='solved')
    throw new Error('resulting sketch is '+solved.status+': '+JSON.stringify(solved.diagnostics));
  const profile=prepareArcProfileForProvider(sketch,solved,selectionRequest(selected));
  return {kind:'accepted',format:ARC_PROFILE_TOOLS_FORMAT,version:1,
    sketch,selection:selected,solution:solved,profile,
    ...signatures(sketch,selected),createdIds,appliedValueMm,
    previewOnly:true};
}

/**
 * Versioned, revision-fenced authoring proposal: a single accepted result is
 * one possible INTENT/RUNTIME journal transaction, never multiple commits.
 */
export function editArcProfileWithTool(source,selected,command,expected){
  const doc=createArcSketch(source),selection=createArcHoleSelection(selected);
  const stamp=signatures(doc,selection);
  const refuse=reason=>({kind:'refused',format:ARC_PROFILE_TOOLS_FORMAT,
    version:1,...stamp,reason});
  if(!exact(expected,['sourceSignature','selectionSignature'])||
     expected.sourceSignature!==stamp.sourceSignature||
     expected.selectionSignature!==stamp.selectionSignature)
    return refuse('stale sketch or profile selection');
  if(!command||typeof command!=='object'||Array.isArray(command))
    return refuse('invalid tool command');
  try{
    if(command.kind==='drag-handle'){
      if(!exact(command,['kind','handleId','xMm','yMm'])||
         !validId(command.handleId)||!finite(command.xMm)||!finite(command.yMm))
        return refuse('invalid pointer handle or target');
      // Resolve stable semantic handles against this revision, never an old
      // pointer index or renderer-owned geometry. One gesture commits once.
      const inspection=inspectArcProfileTools(doc,selection);
      if(inspection.status!=='solved')
        return refuse('handle drag requires a solved, admissible profile');
      const handle=inspection.controls.find(h=>h.id===command.handleId);
      if(!handle)return refuse('unknown or unavailable sketch handle');
      const target={x:command.xMm,y:command.yMm};
      let result,appliedPoint;
      if(handle.kind==='dimension'){
        result=editArcProfileWithTool(doc,selection,{
          kind:'drag-dimension',constraintId:handle.constraintId,
          xMm:target.x,yMm:target.y
        },stamp);
        if(result.kind==='accepted'){
          // For dimensional handles the requested point is a gesture input;
          // the solver, not the cursor, owns the final constrained geometry.
          const next=inspectArcProfileTools(result.sketch,result.selection);
          appliedPoint=next.controls.find(h=>h.id===handle.id)?.position||target;
        }
      }else if(handle.kind==='hole_center'){
        if(!handle.canMove)return refuse('hole centre has other authored dependencies');
        result=editArcProfileWithTool(doc,selection,{
          kind:'hole',change:{kind:'move',circleId:handle.circleId,
            xMm:target.x,yMm:target.y}
        },stamp);
        appliedPoint=target;
      }else if(handle.kind==='hole_diameter'){
        const center=inspection.controls.find(h=>
          h.kind==='hole_center'&&h.circleId===handle.circleId);
        if(!center)return refuse('hole centre handle missing');
        const radius=Math.hypot(target.x-center.position.x,
          target.y-center.position.y),diameterMm=radius*2;
        if(!finite(diameterMm)||diameterMm<=0)
          return refuse('hole diameter drag requires a positive finite radius');
        result=editArcProfileWithTool(doc,selection,{
          kind:'hole',change:{kind:'resize',circleId:handle.circleId,
            diameterMm}
        },stamp);
        appliedPoint={x:center.position.x+radius,y:center.position.y};
      }else return refuse('unsupported pointer handle');
      if(result.kind!=='accepted')return result;
      return {...result,gesture:{
        handleId:handle.id,target,appliedPoint,
        deviationMm:Math.hypot(appliedPoint.x-target.x,appliedPoint.y-target.y)
      }};
    }
    if(command.kind==='translate-holes'){
      if(!exact(command,['kind','circleIds','deltaXMm','deltaYMm'])||
         !Array.isArray(command.circleIds)||command.circleIds.length<1||
         command.circleIds.length>32||!command.circleIds.every(validId)||
         new Set(command.circleIds).size!==command.circleIds.length||
         !finite(command.deltaXMm)||!finite(command.deltaYMm))
        return refuse('invalid selected-hole translation');
      // Update all authored fixed dimensions before solving. Unlike repeated
      // single-hole transactions, intermediate overlaps cannot prevent a
      // valid group translation and the operation is one journal edit.
      const controls=inspectArcHoleControls(doc,selection).controls;
      const chosen=command.circleIds.map(id=>controls.find(c=>c.id===id));
      if(chosen.some(c=>!c||!c.canMove||!c.centerConstraintId))
        return refuse('selected hole missing or constrained by other geometry');
      const next=structuredClone(doc);
      for(const control of chosen){
        const x=control.xMm+command.deltaXMm,y=control.yMm+command.deltaYMm;
        if(!finite(x)||!finite(y))return refuse('hole translation overflows coordinates');
        const fixed=next.constraints.find(c=>c.id===control.centerConstraintId);
        const center=next.points.find(p=>p.id===control.centerPointId);
        if(!fixed||!center)return refuse('missing authored hole centre dimension');
        fixed.x=x;fixed.y=y;center.x=x;center.y=y;
      }
      return {...evaluate(next,selection),movedHoleIds:command.circleIds.slice()};
    }
    if(command.kind==='hole'){
      if(!exact(command,['kind','change']))
        return refuse('invalid hole tool command');
      const result=editArcProfileHole(doc,selection,command.change,stamp);
      if(result.kind!=='accepted')return refuse(result.reason);
      return {...result,format:ARC_PROFILE_TOOLS_FORMAT,
        createdIds:command.change.kind==='add'?[command.change.circleId]:[],
        appliedValueMm:null,previewOnly:true};
    }
    if(command.kind==='dimension'||command.kind==='drag-dimension'){
      if(!exact(command,command.kind==='dimension'?
        ['kind','constraintId','valueMm']:['kind','constraintId','xMm','yMm'])||
         !validId(command.constraintId))
        return refuse('invalid dimension tool command');
      const constraint=doc.constraints.find(c=>c.id===command.constraintId);
      if(!constraint||!['distanceX','distanceY','arcRadius'].includes(constraint.kind))
        return refuse('dimension is not independently editable');
      let value=command.valueMm;
      if(command.kind==='drag-dimension'){
        if(!finite(command.xMm)||!finite(command.yMm))
          return refuse('invalid pointer target');
        const solved=solveArcSketch(doc);
        if(solved.status!=='solved')return refuse('dimension drag requires solved sketch');
        const points=pointMap(doc,solved);
        if(constraint.kind==='arcRadius'){
          const arc=doc.arcs.find(a=>a.id===constraint.arc);
          const center=points.get(arc.center);
          value=Math.hypot(command.xMm-center.x,command.yMm-center.y);
        }else{
          const origin=points.get(constraint.a);
          value=constraint.kind==='distanceX'?
            command.xMm-origin.x:command.yMm-origin.y;
        }
      }
      if(!finite(value)||(constraint.kind==='arcRadius'&&value<=0))
        return refuse('invalid authored dimension');
      return evaluate(editArcConstraint(doc,constraint.id,{value}),selection,[],value);
    }
    if(command.kind==='array'){
      if(!exact(command,['kind','sourceCircleId','patternId','rows','columns',
        'spacingXmm','spacingYmm'])||
        !validId(command.sourceCircleId)||!validId(command.patternId)||
        !Number.isSafeInteger(command.rows)||!Number.isSafeInteger(command.columns)||
        command.rows<1||command.columns<1||command.rows>8||command.columns>8||
        command.rows*command.columns<2||command.rows*command.columns>12||
        !finite(command.spacingXmm)||!finite(command.spacingYmm))
        return refuse('invalid rectangular hole array');
      if(!selection.holeIds.includes(command.sourceCircleId))
        return refuse('array seed must be in selected profile');
      const solved=solveArcSketch(doc);
      if(solved.status!=='solved')return refuse('array seed sketch is not solved');
      // Never use an invalid / boundary-piercing original profile as seed.
      prepareArcProfileForProvider(doc,solved,selectionRequest(selection));
      const circle=doc.circles.find(c=>c.id===command.sourceCircleId);
      const center=pointMap(doc,solved).get(circle.center);
      const next=structuredClone(doc),nextSelection=structuredClone(selection);
      const ids=new Set([...doc.points,...doc.lines,...doc.arcs,...doc.circles,
        ...doc.constraints].map(e=>e.id));
      const createdIds=[];
      for(let row=0;row<command.rows;row++)for(let col=0;col<command.columns;col++){
        if(row===0&&col===0)continue;
        const id=command.patternId+':r'+row+'c'+col;
        const centerId='hole.'+id+'.center',constraintId='hole.'+id+'.fixed';
        if([id,centerId,constraintId].some(name=>!validId(name)||ids.has(name)))
          return refuse('array semantic identity collision');
        [id,centerId,constraintId].forEach(name=>ids.add(name));
        const x=center.x+col*command.spacingXmm,y=center.y+row*command.spacingYmm;
        if(!finite(x)||!finite(y))return refuse('array coordinates overflow');
        next.points.push({id:centerId,x,y});
        next.circles.push({id,center:centerId,radiusMm:circle.radiusMm});
        next.constraints.push({id:constraintId,kind:'fixed',point:centerId,x,y});
        nextSelection.holeIds.push(id);
        createdIds.push(id);
      }
      return evaluate(next,nextSelection,createdIds);
    }
    return refuse('unsupported profile tool');
  }catch(error){
    return refuse('profile tool rejected: '+String(error?.message||error));
  }
}
