import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {SELECTED_LINEAR_PATTERN_HANDLES_VERSION,
  inspectSelectedLinearPatternHandles,dragSelectedLinearPatternHandle,
  type LinearPatternDragAccepted,type LinearPatternDragCommand,
  type LinearPatternDragHandle,type SelectedLinearPatternHandles,
  type LinearPatternDragRefusal
} from '../selected-linear-pattern-handles.mjs';
const sketch=createDimensionedLPlateSketch();
const found=discoverPlateProfiles(sketch);
const selection={candidateId:found.candidates[0]!.id,
  sourceSignature:found.inputSignature};
const version:1=SELECTED_LINEAR_PATTERN_HANDLES_VERSION;
const view=inspectSelectedLinearPatternHandles(sketch,selection,'L:array');
if(view.kind==='selected_linear_pattern_handles'){
  const handles:SelectedLinearPatternHandles=view;
  const handle:LinearPatternDragHandle=handles.handles[0]!;
  const cmd:LinearPatternDragCommand={
    kind:'drag-pattern-handle',sourceSignature:view.sourceSignature,
    patternId:view.patternId,handleId:handle.id,xMm:1,yMm:2
  };
  const result=dragSelectedLinearPatternHandle(sketch,selection,cmd);
  if(result.kind==='accepted'){
    const accepted:LinearPatternDragAccepted=result;
    void accepted.changedConstraintIds;
  }else{
    const denied:LinearPatternDragRefusal=result;
    void denied.reason;
  }
}
void version;
