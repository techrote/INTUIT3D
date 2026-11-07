import {createDimensionedLPlateSketch} from '../selected-profile.mjs';
import {discoverPlateProfiles} from '../profile-discovery.mjs';
import {
  SELECTED_PROFILE_HOLE_AUTHORING_VERSION,
  inspectSelectedProfileHoleAuthoring,editSelectedProfileHole,
  type SelectedProfileHoleCommand,type SelectedProfileHoleInspection,
  type SelectedHoleAnchor,type SelectedHoleControl,
  type SelectedProfileHoleAccepted,type SelectedProfileHoleRefusal
} from '../selected-profile-hole-authoring.mjs';

const sketch=createDimensionedLPlateSketch();
const discovery=discoverPlateProfiles(sketch);
const selection={candidateId:discovery.candidates[0]!.id,
  sourceSignature:discovery.inputSignature};
const candidate=inspectSelectedProfileHoleAuthoring(sketch,selection);
const version:1=SELECTED_PROFILE_HOLE_AUTHORING_VERSION;
if(candidate.kind==='selected_profile_hole_authoring'){
  const inspection:SelectedProfileHoleInspection=candidate;
  const anchor:SelectedHoleAnchor=inspection.anchors[0]!;
  const control:SelectedHoleControl=inspection.holes[0]!;
  const add:SelectedProfileHoleCommand={kind:'add-hole',
    sourceSignature:inspection.sourceSignature,holeId:'holeThird',
    anchorPointId:anchor.pointId,xMm:65,yMm:15,radiusMm:4};
  const outcome=editSelectedProfileHole(sketch,selection,add);
  if(outcome.kind==='accepted'){
    const accepted:SelectedProfileHoleAccepted=outcome;
    const next=accepted.sketch;
    const edit:SelectedProfileHoleCommand={kind:'reanchor-hole',
      sourceSignature:accepted.nextSourceSignature,
      holeId:accepted.holeId,anchorPointId:'L:a'};
    void edit;void next;void control;
  }else{
    const rejected:SelectedProfileHoleRefusal=outcome;
    void rejected.reason;
  }
}
void version;
