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
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import { createWorkflowRuntime } from '@intuit3d/workflow-runtime';
import type { UndoHistory } from '@intuit3d/model/transactions';
import type { RuntimeReport, RuntimeFeature } from '@intuit3d/workflow-runtime';
import type { SketchDocument, PlateProfile } from '@intuit3d/sketch';

export const runtime = createWorkflowRuntime({ model, transactions, bindings, dimensions, archive, sketch, discovery });
export type ModelSession = UndoHistory;
export type ModelDimension = 'width' | 'depth' | 'holeDiameter' | 'holePitch' | 'thickness';
export const MODEL_DIMENSIONS: readonly ModelDimension[] = ['width', 'depth', 'holeDiameter', 'holePitch', 'thickness'];

const feature = (id: string, kind: string, dependsOn: string[], writeTargets: string[], payload: model.JsonRecord): model.Feature =>
  ({ id, kind, dependsOn, writeTargets, payload });
const created = (eventId: string, f: model.Feature): model.JournalEvent => ({ eventId, type:'feature.create', feature:f });
const initial = () => transactions.startUndoHistory(model.newProject('workbench.plate.one'));

export function newModelPlateSession(): ModelSession {
  const h = runtime.commit(initial(), [
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

export function modelDimensionValues(h: ModelSession): Record<ModelDimension, number> {
  const a = dimension(h, 'holeA:fixed'), b = dimension(h, 'holeB:fixed');
  const parameter = getFeature(h, 'parameter.t').payload.parameter;
  if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) throw Error('Invalid thickness parameter');
  const expression = (parameter as Record<string, unknown>).expression;
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) throw Error('Invalid parameter expression');
  const value = (expression as Record<string, unknown>).value;
  if (typeof value !== 'number') throw Error('Thickness expression is not an editable literal');
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
    const source = getFeature(h, 'parameter.t');
    return runtime.commit(h, [{
      eventId, type:'feature.edit', featureId:source.id,
      patch:{ payload:{ ...source.payload, parameter:{
        name:'thickness', unit:'mm', expression:{ op:'literal', unit:'mm', value },
      } } },
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
