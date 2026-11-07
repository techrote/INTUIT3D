/**
 * WORKBENCH's model-backed plate editor. All durable state, history, solver
 * admission and dependency evaluation are delegated to the public packages.
 * Three.js consumes the returned profile only as a NON-AUTHORITATIVE preview.
 */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import { moveHistoryFeature } from '@intuit3d/model/history-move';
import { commitUndoableParameterFreeze, previewParameterFreeze } from '@intuit3d/model/parameter-freeze';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import { createWorkflowRuntime } from '@intuit3d/workflow-runtime';
import type { UndoHistory } from '@intuit3d/model/transactions';
import type { RuntimeReport, RuntimeFeature, SketchConstraintBatchResult } from '@intuit3d/workflow-runtime';
import type { SketchDocument, PlateProfile } from '@intuit3d/sketch';
import type { SketchDimensionHandle } from './runtimeSketchHandles';

export const runtime = createWorkflowRuntime({ model, transactions, bindings, dimensions, archive, sketch, discovery });
export type ModelSession = UndoHistory;
export type ModelDimension = 'width' | 'depth' | 'holeDiameter' | 'holePitch' | 'thickness';
export const MODEL_DIMENSIONS: readonly ModelDimension[] = ['width', 'depth', 'holeDiameter', 'holePitch', 'thickness'];
export type ModelHole = string;
export type ModelHoleField = 'x' | 'y' | 'diameter';
export type ModelHoleDimensions = Readonly<{x:number;y:number;diameter:number}>;

function requireHole(h:ModelSession,hole:ModelHole):void {
  if(!sketchSource(h).circles.some(c=>c.id===hole))
    throw Error('Unknown authoritative sketch hole: '+hole);
}

/** Read authored constraints, never cached preview circles or tessellation. */
export function modelHoleValues(h: ModelSession): Record<ModelHole, ModelHoleDimensions> {
  const constraints = sketchSource(h).constraints;
  const read = (hole: ModelHole): ModelHoleDimensions => {
    const center = constraints.find(c => c.id === hole + ':fixed');
    const radius = constraints.find(c => c.id === hole + ':diameter');
    if (center?.kind !== 'fixed' || radius?.kind !== 'radius') {
      throw Error('Missing authoritative hole constraints: ' + hole);
    }
    return {x:center.x,y:center.y,diameter:radius.value * 2};
  };
  return Object.fromEntries(sketchSource(h).circles.map(c=>[c.id,read(c.id)]));
}

/** Create a durable SKETCH circle/centre/radius through RUNTIME as ONE undoable
 * INTENT transaction. Never edits preview triangles or a parallel document. */
export function addModelHole(h:ModelSession,hole:ModelHole,x:number,y:number,diameter:number):SketchConstraintBatchResult {
  if(![x,y,diameter].every(Number.isFinite) ||
      Math.max(Math.abs(x),Math.abs(y),diameter)>10000 || diameter<=0)
    throw Error('New hole requires finite X/Y and positive diameter within 10,000 mm.');
  return runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:`workbench.hole.add.${h.document.revision}`,
    expectedRevision:h.document.revision,admission:'require_admissible',
    operations:[{kind:'add',id:hole,x,y,radius:diameter/2}],
  });
}

/** Legacy plate pitch/diameter controls depend on both seed circles. Extra
 * circles can be removed; their authored IDs are restored by undo. */
export function removeModelHole(h:ModelSession,hole:ModelHole):SketchConstraintBatchResult {
  requireHole(h,hole);
  if(hole==='holeA'||hole==='holeB')
    throw Error('Base hole is referenced by plate dimension controls.');
  return runtime.editPlateHoles(h,{
    sketchFeatureId:'sketch.plate',eventId:`workbench.hole.remove.${h.document.revision}`,
    expectedRevision:h.document.revision,admission:'require_admissible',
    operations:[{kind:'remove',id:hole}],
  });
}

/** A one-shot array copies the source's SOLVED sketch circle, not seed JSON.
 * Cells become independently editable circles (not associative history).
 * One authoritative RUNTIME/INTENT transaction, with strict SKETCH admission. */
export interface ModelHoleArray {
  readonly sourceHoleId: ModelHole;
  readonly rows: number;
  readonly columns: number;
  readonly pitchXmm: number;
  readonly pitchYmm: number;
}
export function patternModelHoles(h:ModelSession, request:ModelHoleArray):SketchConstraintBatchResult {
  requireHole(h,request.sourceHoleId);
  if(!Number.isSafeInteger(request.rows) || !Number.isSafeInteger(request.columns) ||
      request.rows<1 || request.rows>8 || request.columns<1 || request.columns>8 ||
      request.rows*request.columns<2 || request.rows*request.columns>32 ||
      ![request.pitchXmm,request.pitchYmm].every(v=>Number.isFinite(v)&&Math.abs(v)<=10000) ||
      (request.columns>1&&request.pitchXmm===0) ||
      (request.rows>1&&request.pitchYmm===0))
    throw Error('Array requires 2–32 cells, 1–8 rows/columns and finite nonzero active pitches.');
  return runtime.patternPlateHoles(h,{
    sketchFeatureId:'sketch.plate',
    eventId:`workbench.hole.pattern.${h.document.revision}`,
    expectedRevision:h.document.revision,
    admission:'require_admissible',
    sourceHoleId:request.sourceHoleId,
    idPrefix:`array.${h.document.revision}`,
    rows:request.rows,columns:request.columns,
    pitchXmm:request.pitchXmm,pitchYmm:request.pitchYmm,
  });
}

/** Atomic, revision-fenced individual hole edit via admitted RUNTIME/SKETCH. */
export function editModelHole(
  h:ModelSession, hole:ModelHole, field:ModelHoleField, value:number,
  admission:'require_admissible' | 'preserve_unresolved'='require_admissible',
):SketchConstraintBatchResult {
  requireHole(h,hole);
  if (!['x','y','diameter'].includes(field) || !Number.isFinite(value) ||
      Math.abs(value)>10000 || (field==='diameter' && value<=0)) {
    throw Error('Hole coordinates must be finite within ±10,000 mm; diameter must be positive.');
  }
  return runtime.editSketchConstraints(h,{
    sketchFeatureId:'sketch.plate',eventId:`workbench.hole.${hole}.${field}.${h.document.revision}`,
    expectedRevision:h.document.revision,admission,
    edits:[{constraintId:hole+(field==='diameter'?':diameter':':fixed'),
      patch:field==='diameter'?{value:value/2}:field==='x'?{x:value}:{y:value}}],
  });
}

/** A two-axis drag is one undoable constraint transaction, not two moves. */
export function moveModelHoleCenter(
  h:ModelSession, hole:ModelHole, x:number,y:number,
):SketchConstraintBatchResult {
  requireHole(h,hole);
  if (![x,y].every(v=>Number.isFinite(v)&&Math.abs(v)<=10000)) {
    throw Error('Hole drag coordinates are out of supported range');
  }
  return runtime.editSketchConstraints(h,{
    sketchFeatureId:'sketch.plate',eventId:`workbench.drag.${hole}.${h.document.revision}`,
    expectedRevision:h.document.revision,admission:'require_admissible',
    edits:[{constraintId:hole+':fixed',patch:{x,y}}],
  });
}

/** Gesture/keyboard dimension edit: one authoritative transaction, refusing
 * inadmissible direct manipulation without discarding typed invalid intent.
 * Numeric inspector edits deliberately retain their separate recovery policy. */
export function editModelSketchHandle(
  h:ModelSession,handle:SketchDimensionHandle,value:number,
):{kind:'committed';history:ModelSession;invalidatedFeatureIds:readonly string[]} |
  {kind:'refused';reason:string} {
  if(!Number.isFinite(value)||value<=0||value>10000)
    return {kind:'refused',reason:'Direct dimension must be finite and positive (up to 10,000 mm).'};
  if(handle==='width'||handle==='depth'){
    const candidate=editModelDimension(h,handle,value);
    if(!previewModelProfile(inspectModelSession(candidate)))
      return {kind:'refused',reason:'Resize would invalidate the sketch profile. Use the numeric inspector to preserve and repair an unresolved constraint.'};
    return {kind:'committed',history:candidate,invalidatedFeatureIds:runtime.diff(h,candidate).invalidatedFeatureIds};
  }
  const hole=handle==='holeA.diameter'?'holeA':'holeB';
  const outcome=editModelHole(h,hole,'diameter',value,'require_admissible');
  if(outcome.kind==='refused')
    return {kind:'refused',reason:outcome.reason};
  return {kind:'committed',history:outcome.history,invalidatedFeatureIds:outcome.invalidation.invalidatedFeatureIds};
}

/** Presentation-only timeline move; INTENT preserves body and DAG authority. */
export function moveModelFeature(h:ModelSession,id:string,direction:'earlier'|'later') {
  const order=inspectModelSession(h).authoredOrder;
  const index=order.indexOf(id);
  if(index<0 || (direction==='earlier'&&index===0) ||
     (direction==='later'&&index===order.length-1)) throw Error('No adjacent timeline position');
  const afterFeatureId=direction==='earlier'?(index===1?null:order[index-2]):order[index+1];
  return moveHistoryFeature(h,{
    eventId:`workbench.move.${id}.${h.document.revision}`,
    featureId:id,afterFeatureId,
    expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
  });
}


const feature = (id: string, kind: string, dependsOn: string[], writeTargets: string[], payload: model.JsonRecord): model.Feature =>
  ({ id, kind, dependsOn, writeTargets, payload });
const created = (eventId: string, f: model.Feature): model.JournalEvent => ({ eventId, type:'feature.create', feature:f });
const initial = (projectId: string) => transactions.startUndoHistory(model.newProject(projectId));

/** A new plate is a fresh semantic project, not a reset of the previous journal. */
export function newModelPlateSession(projectId = 'workbench.plate.one'): ModelSession {
  const h = runtime.commit(initial(projectId), [
    created('create.sketch', feature('sketch.plate', 'sketch', [], [], { sketch: sketch.plateSketchFixture() as unknown as model.JsonValue })),
    created('create.extrude', feature('plate', 'extrude', ['sketch.plate'], ['body.plate'],
      { sourceSketchId:'sketch.plate', thicknessMm:8 })),
    created('create.cut', feature('cut', 'cut', ['plate'], ['body.plate'],
      { sourceSketchId:'sketch.plate', targetBodyId:'body.plate' })),
    // Authored AFTER the dependent extrusion: the binding inserts a semantic
    // dependency, not a destructive chronology rewrite.
    created('create.parameter', feature('parameter.t', 'parameter', [], [],
      { parameter:{ name:'thickness', unit:'mm', expression:{ op:'literal', value:10, unit:'mm' } } })),
  ]);
  return runtime.editDimensions(h, {
    format: dimensions.DIMENSION_BATCH_EDIT_FORMAT, version: dimensions.DIMENSION_BATCH_EDIT_VERSION,
    expectedRevision:h.document.revision, admission:'require_admissible',
    edits:[{ eventId:'bind.plate.thickness', featureId:'plate', field:'thicknessMm',
      binding:{ unit:'mm', expression:{ op:'ref', featureId:'parameter.t' } } }],
  });
}

function getFeature(h: ModelSession, id: string): model.Feature {
  const f = model.featuresOf(h.document).find(item => item.id === id);
  if (!f) throw Error('Missing authoritative feature ' + id);
  return f;
}
function sketchSource(h: ModelSession): SketchDocument {
  return sketch.validateSketch(getFeature(h, 'sketch.plate').payload.sketch);
}
function dimension(h: ModelSession, id: string): number {
  const c = sketchSource(h).constraints.find(item => item.id === id);
  if (!c) throw Error('Missing sketch dimension ' + id);
  if (c.kind === 'fixed') return c.x;
  if (c.kind !== 'distanceX' && c.kind !== 'distanceY' && c.kind !== 'radius') throw Error('Not a scalar dimension ' + id);
  return c.value;
}

/** Binding truth is the authoritative INTENT manifest, never a local UI flag.
 * A frozen extrusion has a literal thickness and no parameter feature. */
export function modelThicknessBinding(h: ModelSession): 'named_parameter' | 'independent' {
  const manifest = getFeature(h,'plate').payload.dimensionBindings;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return 'independent';
  const entries = (manifest as Record<string, unknown>).entries;
  return Array.isArray(entries) && entries.some((entry:unknown) =>
    !!entry && typeof entry === 'object' && !Array.isArray(entry) &&
      (entry as Record<string,unknown>).field === 'thicknessMm')
    ? 'named_parameter' : 'independent';
}

/** Freeze CURRENT resolved thickness, explicitly release the witnessed binding
 * edge and retire the now-unused parameter in ONE undoable INTENT transaction.
 * The model API refuses stale, unresolved or non-owned releases. */
export function makeModelThicknessIndependent(h: ModelSession): {
  history: ModelSession;
  bakedThicknessMm: number;
  invalidatedFeatureIds: readonly string[];
} {
  if(modelThicknessBinding(h)!=='named_parameter')
    throw Error('Thickness is already independent');
  const revision=h.document.revision;
  const request={
    format:'intuit3d.parameter-freeze',version:1,expectedRevision:revision,
    admission:'require_admissible',
    edits:[{eventId:`workbench.freeze.thickness.${revision}`,featureId:'plate',field:'thicknessMm'}],
    release:[{eventId:`workbench.freeze.release.${revision}`,featureId:'plate',dependencies:['parameter.t']}],
    confirmIndependentIntentReviewed:true,
    retire:{eventId:`workbench.freeze.retire.${revision}`,parameterId:'parameter.t'},
  } as const;
  const preview=previewParameterFreeze(h.document,request);
  const history=commitUndoableParameterFreeze(h,request);
  if (preview.baked.length!==1 || preview.baked[0].featureId!=='plate')
    throw Error('Unexpected parameter freeze result');
  return {
    history,bakedThicknessMm:preview.baked[0].value,
    invalidatedFeatureIds:preview.invalidation.invalidatedFeatureIds,
  };
}

export function modelDimensionValues(h: ModelSession): Record<ModelDimension, number> {
  const a = dimension(h, 'holeA:fixed'), b = dimension(h, 'holeB:fixed');
  let value: unknown;
  if (modelThicknessBinding(h)==='named_parameter') {
    const parameter = getFeature(h, 'parameter.t').payload.parameter;
    if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) throw Error('Invalid thickness parameter');
    const expression = (parameter as Record<string, unknown>).expression;
    if (!expression || typeof expression !== 'object' || Array.isArray(expression)) throw Error('Invalid parameter expression');
    value = (expression as Record<string, unknown>).value;
  } else {
    value = getFeature(h,'plate').payload.thicknessMm;
  }
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw Error('Invalid authoritative thickness dimension');
  return {
    width: dimension(h,'width'), depth: dimension(h,'height'),
    holeDiameter: 2 * dimension(h,'holeA:diameter'), holePitch: b-a,
    thickness: value,
  };
}

export function editModelDimension(h: ModelSession, field: ModelDimension, value: number): ModelSession {
  if (!MODEL_DIMENSIONS.includes(field) || !Number.isFinite(value) || value <= 0 || value > 10_000) {
    throw Error('Enter a finite positive dimension (0–10,000 mm); no change was committed.');
  }
  const eventId = `workbench.edit.${field}.${h.document.revision}`;
  if (field === 'thickness') {
    if (modelThicknessBinding(h)==='named_parameter') {
      const source = getFeature(h, 'parameter.t');
      return runtime.commit(h, [{
        eventId, type:'feature.edit', featureId:source.id,
        patch:{ payload:{ ...source.payload, parameter:{
          name:'thickness', unit:'mm', expression:{ op:'literal', unit:'mm', value },
        } } },
      }]);
    }
    const source = getFeature(h,'plate');
    return runtime.commit(h,[{
      eventId,type:'feature.edit',featureId:source.id,
      patch:{payload:{...source.payload,thicknessMm:value}},
    }]);
  }
  const source = getFeature(h,'sketch.plate');
  let s = sketchSource(h);
  if (field === 'width') s = sketch.editConstraint(s,'width',{value});
  if (field === 'depth') s = sketch.editConstraint(s,'height',{value});
  if (field === 'holeDiameter') {
    s = sketch.editConstraint(s,'holeA:diameter',{value:value/2});
    s = sketch.editConstraint(s,'holeB:diameter',{value:value/2});
  }
  if (field === 'holePitch') {
    const middle = (dimension(h, 'holeA:fixed') + dimension(h, 'holeB:fixed'))/2;
    s = sketch.editConstraint(s,'holeA:fixed',{x:middle-value/2});
    s = sketch.editConstraint(s,'holeB:fixed',{x:middle+value/2});
  }
  return runtime.commit(h,[{
    eventId, type:'feature.edit', featureId:source.id,
    patch:{ payload:{ ...source.payload, sketch:s as unknown as model.JsonValue } },
  }]);
}

export function inspectModelSession(h: ModelSession): RuntimeReport {
  return runtime.inspect(h);
}

export function previewModelProfile(report: RuntimeReport): {profile:PlateProfile;thickness:number}|null {
  const plate = report.features.find(f => f.featureId === 'plate');
  if (plate?.status !== 'preview_only' || !plate.profile || !plate.thicknessMm ||
      plate.profile.status !== 'analytic_profile_only') return null;
  return {profile:plate.profile, thickness:plate.thicknessMm};
}

export function modelDiagnostics(report: RuntimeReport): RuntimeFeature[] {
  return report.features.filter(f => !['intent_ready','analytic_profile_only','preview_only'].includes(f.status));
}

export function undoModelSession(h: ModelSession): ModelSession {
  if (!h.undoStack.length) return h;
  return runtime.undo(h,[`undo.workbench.${h.document.revision}`]);
}
export function redoModelSession(h: ModelSession): ModelSession {
  if (!h.redoStack.length) return h;
  return runtime.redo(h,[`redo.workbench.${h.document.revision}`]);
}
export function serializeModelSession(h: ModelSession): string { return runtime.save(h); }
export function reopenModelSession(text: string): ModelSession {
  if (text.length > 4*1024*1024) throw Error('Model archive exceeds 4 MiB workbench limit');
  const h = runtime.reopen(text);
  // Strictly this first consumer supports only its own plate fixture topology.
  // Unrecognized authoritative projects are never coerced into the preview.
  modelDimensionValues(h);
  runtime.inspect(h);
  return h;
}
