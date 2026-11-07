import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {SELECTED_LINEAR_HOLE_PATTERN_VERSION,inspectSelectedLinearHolePattern,
  editSelectedLinearHolePattern,type SelectedLinearHolePatternCommand,
  type SelectedLinearHolePatternInspection,type SelectedLinearHolePatternAccepted,
  type SelectedLinearHolePatternRefusal,type LinearHolePatternMember
} from '../selected-linear-hole-pattern.mjs';
const sketch=createDimensionedLPlateSketch();
const found=discoverPlateProfiles(sketch);
const selection={candidateId:found.candidates[0]!.id,
  sourceSignature:found.inputSignature};
const version:1=SELECTED_LINEAR_HOLE_PATTERN_VERSION;
const create:SelectedLinearHolePatternCommand={kind:'create-pattern',
  sourceSignature:found.inputSignature,patternId:'L:array',
  anchorPointId:'L:b',firstXmm:52,firstYmm:15,
  pitchXmm:14,pitchYmm:0,radiusMm:3,count:2};
const outcome=editSelectedLinearHolePattern(sketch,selection,create);
if(outcome.kind==='accepted'){
  const success:SelectedLinearHolePatternAccepted=outcome;
  const view=inspectSelectedLinearHolePattern(success.sketch,
    success.selection,'L:array');
  if(view.kind==='selected_linear_hole_pattern'){
    const inspection:SelectedLinearHolePatternInspection=view;
    const item:LinearHolePatternMember=inspection.members[0]!;
    const next:SelectedLinearHolePatternCommand={kind:'set-pattern',
      sourceSignature:inspection.sourceSignature,patternId:inspection.patternId,
      pitchXmm:12,pitchYmm:0,radiusMm:4,count:3};
    void next;void item;
  }else{
    const denied:SelectedLinearHolePatternRefusal=view;
    void denied.reason;
  }
}else{const denied:SelectedLinearHolePatternRefusal=outcome;void denied.reason;}
void version;
