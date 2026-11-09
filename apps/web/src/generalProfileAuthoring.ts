/**
 * User-selected canonical SKETCH cycles consumed through FEATUREOPS v1.
 * Presentation supplies explicit IDs and a canonical archive fence; it never
 * authors a feature payload, solver, source signature or native geometry.
 */
import * as model from '@intuit3d/model';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {
  PROFILE_OPS_FORMAT, PROFILE_OPS_VERSION,
  authorProfileExtrusion, authorProfileBodyCut,
} from '@intuit3d/feature-ops';
import {
  EXTRUSION_RECONFIG_FORMAT, EXTRUSION_RECONFIG_VERSION,
  reconfigureProfileExtrusion,
} from '@intuit3d/feature-ops/extrusion-reconfiguration/v1';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import {
  modelCurrentSketch, runtime, serializeModelSession, type ModelSession,
} from './runtimeSession.ts';

const services = {runtime, model, sketch, discovery};
const sourceSketchId = 'sketch.plate' as const;
const protocol = {
  format:PROFILE_OPS_FORMAT,version:PROFILE_OPS_VERSION,
  units:'mm' as const,frame:'local_xy' as const,
};

/** Fences an actual user pointer selection to the COMPLETE persisted source.
 * The accepted SKETCH discovery must yield the same unique canonical cycle.
 * A reused equal-revision but divergent archive is always refused. */
export function selectedGeneralProfile(
  history:ModelSession,selection:SelectedProfileSelection,expectedArchive:string,
):string {
  if(expectedArchive!==serializeModelSession(history))
    throw Error('Selected profile has a stale canonical archive. Reselect this contour.');
  const source=modelCurrentSketch(history);
  if(selection.sourceSignature!==sketch.serializeSketch(source))
    throw Error('Selected profile has a stale SKETCH signature. Reselect this contour.');
  const proposal=discovery.discoverPlateProfiles(source);
  if(proposal.status!=='ready'||proposal.candidates.length!==1||
     proposal.candidates[0].id!==selection.candidateId)
    throw Error('Selected contour is not the unique admitted canonical SKETCH cycle.');
  if(runtime.inspect(history).features.find(f=>f.featureId===sourceSketchId)?.status!=='analytic_profile_only')
    throw Error('The authoritative RUNTIME has not admitted the selected SKETCH profile.');
  return proposal.candidates[0].id;
}

/** Only real, active generalized body writers are listed as cut targets. */
export function generalProfileBodies(history:ModelSession):ReadonlyArray<{
  extrudeId:string;bodyId:string;sourceSketchId:string;depthMm:number;
}> {
  const report=runtime.inspect(history);
  return model.featuresOf(history.document).flatMap(f=>{
    if(f.kind!=='extrude'||f.payload.units!=='mm'||
       f.payload.frame!=='local_xy'||typeof f.payload.sourceSketchId!=='string'||
       typeof f.payload.thicknessMm!=='number'||f.writeTargets.length!==1||
       report.features.find(r=>r.featureId===f.id)?.status!=='preview_only')
      return [];
    return [{extrudeId:f.id,bodyId:f.writeTargets[0],
      sourceSketchId:f.payload.sourceSketchId,depthMm:f.payload.thicknessMm}];
  });
}

/** One RUNTIME-authored journal frame, via the accepted FEATUREOPS consumer. */
export function authorGeneralProfileExtrusion(
  history:ModelSession,selection:SelectedProfileSelection,expectedArchive:string,
  extrudeFeatureId:string,outputBodyId:string,depthMm:number,
) {
  const profileCandidateId=selectedGeneralProfile(history,selection,expectedArchive);
  if(!Number.isFinite(depthMm)||depthMm<=0||depthMm>10000)
    throw Error('Extrusion depth must be positive and at most 10,000 mm.');
  return authorProfileExtrusion(history,{
    ...protocol,eventId:'workbench.profile.extrude.'+history.document.revision,
    expectedRevision:history.document.revision,sourceSketchId,
    profileCandidateId,extrudeFeatureId,outputBodyId,depthMm,
  },services);
}

/** A target selection is mandatory even for a one-body project. */
export function authorGeneralProfileCut(
  history:ModelSession,selection:SelectedProfileSelection,expectedArchive:string,
  extrudeFeatureId:string,targetBodyId:string,cutFeatureId:string,
) {
  const profileCandidateId=selectedGeneralProfile(history,selection,expectedArchive);
  if(!generalProfileBodies(history).some(b=>
      b.extrudeId===extrudeFeatureId&&b.bodyId===targetBodyId))
    throw Error('Select a currently admitted named extrusion and its exact target body.');
  return authorProfileBodyCut(history,{
    ...protocol,eventId:'workbench.profile.cut.'+history.document.revision,
    expectedRevision:history.document.revision,sourceSketchId,
    profileCandidateId,extrudeFeatureId,cutFeatureId,targetBodyId,
  },services);
}

/** Preserves existing body and cut IDs, including dependency invalidation. */
export function redimensionGeneralProfileExtrusion(
  history:ModelSession,selection:SelectedProfileSelection,expectedArchive:string,
  extrudeFeatureId:string,outputBodyId:string,depthMm:number,
) {
  const profileCandidateId=selectedGeneralProfile(history,selection,expectedArchive);
  const current=generalProfileBodies(history).find(b=>
    b.extrudeId===extrudeFeatureId&&b.bodyId===outputBodyId);
  if(!current)throw Error('Selected named extrusion/body is not current.');
  if(!Number.isFinite(depthMm)||depthMm<=0||depthMm>10000)
    throw Error('Extrusion depth must be positive and at most 10,000 mm.');
  return reconfigureProfileExtrusion(history,{
    format:EXTRUSION_RECONFIG_FORMAT,version:EXTRUSION_RECONFIG_VERSION,
    eventId:'workbench.profile.depth.'+history.document.revision,
    expectedRevision:history.document.revision,units:'mm',frame:'local_xy',
    extrudeFeatureId,outputBodyId,
    from:{sourceSketchId:current.sourceSketchId,depthMm:current.depthMm},
    to:{sourceSketchId,profileCandidateId,depthMm},
  },services);
}
