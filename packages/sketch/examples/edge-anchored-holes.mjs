import {roundedPlateArcFixture,editArcConstraint,serializeArcSketch,parseArcSketch,
  solveArcSketch} from '../arc-constraints.mjs';
import {createArcHoleSelection,serializeArcHoleSelection} from '../arc-hole-authoring.mjs';
import {inspectArcHoleAnchor,proposeArcHoleAnchor} from '../arc-hole-anchors.mjs';
import {editArcProfileWithTool} from '../arc-profile-tools.mjs';
const select=createArcHoleSelection({format:'intuit3d.arc-hole-selection',
  version:1,profileId:'plate:main',
  boundaryIds:['bottom','arc1','right','arc2','top','arc3','left','arc0'],
  holeIds:['holeA','holeB']});
const stamp=sketch=>({sourceSignature:serializeArcSketch(sketch),
  selectionSignature:serializeArcHoleSelection(select)});
const apply=(sketch,command)=>{
  const result=proposeArcHoleAnchor(sketch,select,command,stamp(sketch));
  if(result.kind!=='accepted')throw new Error(result.reason);
  return result;
};
const emit=(step,sketch,extra={})=>{
  const solution=solveArcSketch(sketch);
  const holeB=solution.geometry?.points.find(p=>p.id==='holeB:center');
  console.log(JSON.stringify({step,solver:solution.status,
    holeB:holeB?{xMm:holeB.x,yMm:holeB.y}:null,
    nativeExact:false,stepQualified:false,...extra}));
};
const initial=roundedPlateArcFixture();
const bound=apply(initial,{kind:'bind',circleId:'holeB',anchorPointId:'p1'});
emit('bind',bound.sketch,{offsets:bound.binding.binding});
const wider=editArcConstraint(bound.sketch,'plate:width',{value:150});
emit('width-edit',wider,{widthMm:150});
const dragged=apply(wider,{kind:'drag-center',circleId:'holeB',
  handleId:'hole-center:holeB',xMm:120,yMm:45});
emit('drag',dragged.sketch,{offsets:dragged.binding.binding});
const reopened=parseArcSketch(serializeArcSketch(dragged.sketch));
emit('reopen',reopened,{offsets:inspectArcHoleAnchor(reopened,select,'holeB').binding});
const moved=editArcProfileWithTool(reopened,select,{kind:'translate-holes',
  circleIds:['holeA','holeB'],deltaXMm:2,deltaYMm:0},stamp(reopened));
if(moved.kind!=='accepted')throw new Error(moved.reason);
emit('group-drag',moved.sketch,{holeIds:moved.movedHoleIds});
const collision=apply(initial,{kind:'bind',circleId:'holeB',anchorPointId:'p1'});
const refused=proposeArcHoleAnchor(collision.sketch,select,{kind:'drag-center',
  circleId:'holeB',handleId:'hole-center:holeB',xMm:35,yMm:40},
  stamp(collision.sketch));
if(refused.kind!=='refused')throw new Error('overlapping placement accepted');
emit('collision-refused',collision.sketch,{reason:refused.reason});
const detached=apply(moved.sketch,{kind:'detach',circleId:'holeB'});
emit('detach',detached.sketch,{binding:detached.binding.mode});
