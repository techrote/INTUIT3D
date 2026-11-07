import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {
  SELECTED_PROFILE_HOLE_LAYOUT_VERSION,
  inspectSelectedProfileHoleLayout,editSelectedProfileHoleLayout,
  type SelectedProfileHoleLayoutControl,type SelectedProfileHoleLayoutCommand,
  type SelectedProfileHoleLayoutAccepted,type SelectedProfileHoleLayoutRefusal,
  type SelectedProfileHoleLayoutInspection
} from '../selected-profile-hole-layout.mjs';

const sketch=createDimensionedLPlateSketch();
const discovery=discoverPlateProfiles(sketch);
const selection={candidateId:discovery.candidates[0]!.id,
  sourceSignature:discovery.inputSignature};
const version:1=SELECTED_PROFILE_HOLE_LAYOUT_VERSION;
const view=inspectSelectedProfileHoleLayout(sketch,selection);
if(view.kind==='selected_profile_hole_layout'){
  const inspection:SelectedProfileHoleLayoutInspection=view;
  const h:SelectedProfileHoleLayoutControl=inspection.holes[0]!;
  const cmd:SelectedProfileHoleLayoutCommand={
    kind:'set-hole-layout',sourceSignature:inspection.sourceSignature,
    edits:[{holeId:h.holeId,xMm:h.position.x+1,yMm:h.position.y,
      radiusMm:h.radiusMm}]
  };
  const result=editSelectedProfileHoleLayout(sketch,selection,cmd);
  if(result.kind==='accepted'){
    const accepted:SelectedProfileHoleLayoutAccepted=result;
    const changed:string[]=accepted.changedConstraintIds;
    const newSource=accepted.sketch;
    const applied:typeof accepted.edits[number]=accepted.edits[0]!;
    void changed;void newSource;void applied;
  }else{
    const refused:SelectedProfileHoleLayoutRefusal=result;
    void refused.reason;
  }
}
void version;
