#!/usr/bin/env node
/**
 * Runnable INTUIT -> SKETCH -> RUNTIME -> experimental OCP plate/cut/STEP flow.
 * A genuinely model-backed local executable, not a browser or production OCCT
 * implementation. All STEP readback is SAME-ENGINE; exactAuthority remains false.
 */
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import {createWorkflowRuntime} from '@intuit3d/workflow-runtime';
import {PLATE_PROTOCOL, parsePlateRequest} from '@intuit3d/kernel-contract/plate-v1';
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';

export const runtime = createWorkflowRuntime({model, transactions, bindings, dimensions, archive, sketch, discovery});
const created=(eventId,feature)=>({eventId,type:'feature.create',feature});
const feature=(id,kind,dependsOn,writeTargets,payload)=>
  ({id,kind,dependsOn,writeTargets,payload});

/** Centre a real SKETCH constraint fixture on the supported plate-v1 local XY frame. */
export function centeredPlateSketch() {
  const source=sketch.plateSketchFixture();
  return sketch.validateSketch({
    ...source,
    points:source.points.map(p=>({...p,x:p.x-60,y:p.y-40})),
    constraints:source.constraints.map(c=>c.kind==='fixed'
      ? {...c,x:c.x-60,y:c.y-40}:c),
  });
}

/** One authoritative journal; the retrospective parameter is authored AFTER cut. */
export function newPlateHistory() {
  let history=transactions.startUndoHistory(model.newProject('integration.plate.twoholes'));
  history=runtime.commit(history,[
    created('create.sketch',feature('sketch.plate','sketch',[],[],{sketch:centeredPlateSketch()})),
    created('create.extrude',feature('plate','extrude',['sketch.plate'],['body.plate'],
      {sourceSketchId:'sketch.plate',thicknessMm:8})),
    created('create.cut',feature('cut','cut',['plate'],['body.plate'],
      {sourceSketchId:'sketch.plate',targetBodyId:'body.plate'})),
    created('create.parameter',feature('parameter.t','parameter',[],[],{
      parameter:{name:'thickness',unit:'mm',expression:{op:'literal',value:8,unit:'mm'}},
    })),
  ]);
  history=runtime.editDimensions(history,{
    format:dimensions.DIMENSION_BATCH_EDIT_FORMAT,
    version:dimensions.DIMENSION_BATCH_EDIT_VERSION,
    expectedRevision:history.document.revision,admission:'require_admissible',
    edits:[{eventId:'bind.plate.thickness',featureId:'plate',field:'thicknessMm',
      binding:{unit:'mm',expression:{op:'ref',featureId:'parameter.t'}}}],
  });
  return history;
}

/** Retrospective edit: preserve extrude's authored payload and feature ID. */
export function editPlateThickness(history,value) {
  if(!Number.isFinite(value)||value<=0) throw Error('positive finite thickness required');
  const source=model.featuresOf(history.document).find(f=>f.id==='parameter.t');
  if(source?.kind!=='parameter') throw Error('authoritative thickness parameter is missing');
  return runtime.commit(history,[{
    eventId:'edit.thickness.'+history.document.revision,
    type:'feature.edit',featureId:'parameter.t',
    patch:{payload:{parameter:{name:'thickness',unit:'mm',
      expression:{op:'literal',value,unit:'mm'}}}},
  }]);
}

/**
 * Refuse to guess how an arbitrary sketch maps to plate-v1: four distinct
 * rectangle corners, XY local-centred at the origin, one named output body
 * and an explicitly authored cut operation are required. This maps a real
 * admitted analytic SKETCH profile into a separate EXPERIMENTAL B-rep request;
 * it does not make RUNTIME's cut state authoritative or exact.
 */
export function plateRequestFromHistory(history,exportStep=true) {
  const report=runtime.inspect(history);
  const state=id=>report.features.find(f=>f.featureId===id);
  const plate=state('plate'),cut=state('cut');
  if(plate?.status!=='preview_only'||plate.bodyId!=='body.plate'||
      plate.sourceSketchId!=='sketch.plate'||!plate.profile) {
    throw Error('no current admitted plate preview; unresolved feature cannot export');
  }
  if(cut?.status!=='pending_exact_provider'||cut.modelStatus!=='ready') {
    throw Error('no explicit executable cut intent; refusing inferred through-hole');
  }
  const authoredCut=model.featuresOf(history.document).find(f=>f.id==='cut');
  if(authoredCut?.kind!=='cut'||authoredCut.payload?.targetBodyId!==plate.bodyId||
      authoredCut.payload?.sourceSketchId!==plate.sourceSketchId||
      !authoredCut.dependsOn.includes('plate')||
      !authoredCut.writeTargets.includes(plate.bodyId)) {
    throw Error('cut semantic target/source mismatch');
  }
  const profile=plate.profile;
  if(profile.status!=='analytic_profile_only'||profile.units!=='mm'||
      !Array.isArray(profile.outer)||profile.outer.length!==4||
      !Array.isArray(profile.holes)) throw Error('unsupported sketch profile');
  const xs=profile.outer.map(p=>p.x),ys=profile.outer.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=maxX-minX,depth=maxY-minY;
  const corners=new Set(profile.outer.map(p=>p.x+','+p.y));
  const wanted=new Set([minX+','+minY,minX+','+maxY,maxX+','+minY,maxX+','+maxY]);
  if(!Number.isFinite(width)||!Number.isFinite(depth)||width<=0||depth<=0||
      minX!==-maxX||minY!==-maxY||
      corners.size!==4||[...corners].some(p=>!wanted.has(p))) {
    throw Error('plate-v1 requires a centred axis-aligned rectangle; no silent STEP placement');
  }
  const request=parsePlateRequest({
    protocol:PLATE_PROTOCOL,requestId:'integration.plate.'+report.revision,
    featureId:'plate',revision:report.revision,units:'mm',exportStep,
    plate:{width,depth,thickness:plate.thicknessMm,
      holes:profile.holes.map(h=>({x:h.x,y:h.y,radius:h.radius}))},
  });
  return {request,report};
}

/** Outputs two REAL experimental STEP files and a replayable INTENT archive. */
export async function executeModelNativePlate(basePath,editedThickness=12) {
  if(typeof basePath!=='string'||!basePath.trim()) throw Error('new output base path required');
  const base=resolve(basePath);
  const originalPath=base+'.initial.step',editedPath=base+'.edited.step',archivePath=base+'.intuit3d.json';
  const first=newPlateHistory();
  const before=plateRequestFromHistory(first);
  const restored=runtime.reopen(runtime.save(first));
  const changed=editPlateThickness(restored,editedThickness);
  const after=plateRequestFromHistory(changed);
  const invalidation=runtime.diff(restored,changed);
  if(!invalidation.invalidatedFeatureIds.includes('plate')||
     !invalidation.invalidatedFeatureIds.includes('cut')||
     invalidation.exactReuseAllowed) throw Error('dependent geometry invalidation unavailable');
  // Preserve the new authored document even if native execution is unavailable.
  // This is exclusive local creation, NOT a crash-atomic production file store.
  await writeFile(archivePath,runtime.save(changed),{flag:'wx',mode:0o600});
  const initial=await runExperimentalPlate(before.request,{
    readCurrentRevision:()=>first.document.revision,stepOutput:originalPath,timeoutMs:60000,
  });
  if(initial.kind!=='experimental_report'||!initial.artifact) {
    throw Error('initial native OCP/STEP unresolved: '+JSON.stringify(initial));
  }
  const edited=await runExperimentalPlate(after.request,{
    readCurrentRevision:()=>changed.document.revision,stepOutput:editedPath,timeoutMs:60000,
  });
  if(edited.kind!=='experimental_report'||!edited.artifact) {
    throw Error('edited native OCP/STEP unresolved: '+JSON.stringify(edited));
  }
  return {
    projectId:after.report.projectId,
    authoredOrder:after.report.authoredOrder,executionOrder:after.report.executableOrder,
    revisionBefore:before.request.revision,revisionAfter:after.request.revision,
    invalidatedFeatureIds:invalidation.invalidatedFeatureIds,
    runtimeCutStatus:after.report.features.find(f=>f.featureId==='cut')?.status,
    initial:{plate:before.request.plate,volumeMm3:initial.observed.source.volumeMm3,
      step:initial.artifact},
    edited:{plate:after.request.plate,volumeMm3:edited.observed.source.volumeMm3,
      step:edited.artifact},
    archivePath,
    provenance:'experimental_OCP_7.9.3.1_same_engine_STEP_readback',
    exactAuthority:false,independentInteroperability:false,
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [base,thickness='12']=process.argv.slice(2);
  if(!base||!Number.isFinite(Number(thickness))||Number(thickness)<=0) {
    console.error('Usage: node tooling/model-native-plate.mjs <NEW-output-basename> [edited-thickness-mm]');
    process.exitCode=2;
  } else {
    try {
      const result=await executeModelNativePlate(base,Number(thickness));
      console.log(JSON.stringify(result,null,2));
    } catch(error) {
      console.error('MODEL_NATIVE_EXPERIMENTAL_FAILED:',error instanceof Error?error.message:String(error));
      process.exitCode=1;
    }
  }
}
