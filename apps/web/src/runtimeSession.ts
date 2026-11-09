/**
 * WORKBENCH's model-backed plate editor. All durable state, history, solver
 * admission and dependency evaluation are delegated to the public packages.
 * Three.js consumes the returned profile only as a NON-AUTHORITATIVE preview.
 */
import * as model from '@intuit3d/model';
import * as transactions from '@intuit3d/model/transactions';
import * as bindings from '@intuit3d/model/dimension-bindings';
import { evaluateParameterPlan } from '@intuit3d/model/parameters';
import type { ParameterExpression, ParameterUnit } from '@intuit3d/model/parameters';
import { formatParameterFormula } from '@intuit3d/model/parameter-formula';
import {
  PARAMETER_FORMULA_TABLE_FORMAT, PARAMETER_FORMULA_TABLE_VERSION,
  previewParameterFormulaTableEdit, commitUndoableParameterFormulaTableEdit,
} from '@intuit3d/model/parameter-formula-table';
import { rebaseParameterSheetEdit } from '@intuit3d/model/parameter-sheet-rebase';
import type { ParameterSheetConflictApproval, ParameterSheetEventReplacement, ParameterSheetResolutionResult } from '@intuit3d/model/parameter-sheet-resolution';
import {
  PARAMETER_SHEET_RESOLUTION_FORMAT, PARAMETER_SHEET_RESOLUTION_VERSION,
  resolveParameterSheetConflict,
} from '@intuit3d/model/parameter-sheet-resolution';
import * as dimensions from '@intuit3d/model/dimension-batch-edit';
import * as archive from '@intuit3d/model/archive';
import { moveHistoryFeature } from '@intuit3d/model/history-move';
import * as lifecycle from '@intuit3d/model/feature-lifecycle';
import { commitUndoableParameterFreeze, previewParameterFreeze } from '@intuit3d/model/parameter-freeze';
import { commitUndoableParameterInspectorEdit, PARAMETER_INSPECTOR_FORMAT, PARAMETER_INSPECTOR_VERSION } from '@intuit3d/model/parameter-inspector';
import * as sketch from '@intuit3d/sketch';
import * as discovery from '@intuit3d/sketch/profile-discovery/v1';
import { createWorkflowRuntime } from '@intuit3d/workflow-runtime';
import type { UndoHistory } from '@intuit3d/model/transactions';
import type { RuntimeReport, RuntimeFeature, SketchConstraintBatchResult } from '@intuit3d/workflow-runtime';
import type { SketchDocument, PlateProfile } from '@intuit3d/sketch';
import type { SketchDimensionHandle } from './runtimeSketchHandles';

export const runtime = createWorkflowRuntime({ model, transactions, bindings, dimensions, archive, sketch, discovery });
export type ModelSession = UndoHistory;

/** Full authored feature inventory, including reversible tombstones. */
export function modelFeatureTimeline(h:ModelSession) {
  return model.featureTimelineOf(h.document);
}

/** UI can remove authored solids/cuts without destroying sketch input or
 * parameter sources. Lifecycle impact is computed by INTENT, not the DOM. */
export function modelFeatureRemovalImpact(h:ModelSession,featureId:string) {
  if(featureId!=='plate' && featureId!=='cut')
    throw Error('This workbench supports removing only extrusion and cut features.');
  return lifecycle.inspectFeatureRemoval(h.document,featureId);
}

export function removeModelFeature(h:ModelSession,featureId:string,cascade=false) {
  const impact=modelFeatureRemovalImpact(h,featureId);
  const victims=cascade?impact.cascadeIds:[featureId];
  const request:lifecycle.FeatureRemovalRequest={
    format:lifecycle.FEATURE_LIFECYCLE_FORMAT,version:lifecycle.FEATURE_LIFECYCLE_VERSION,
    action:'remove',expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    featureId,mode:cascade?'cascade_descendants':'keep_dependents_pending',
    confirmCascade:cascade,
    eventIds:victims.map((_,i)=>`workbench.remove.${h.document.revision}.${i}`),
  };
  return {history:lifecycle.commitUndoableFeatureRemoval(h,request),impact};
}

export function restoreModelFeature(h:ModelSession,featureId:string) {
  if(featureId!=='plate' && featureId!=='cut')
    throw Error('This workbench supports restoring only extrusion and cut features.');
  if(!model.featureTimelineOf(h.document).some(t=>t.featureId===featureId&&!t.active))
    throw Error('Selected feature has no inactive tombstone.');
  const request:lifecycle.FeatureRestorationRequest={
    format:lifecycle.FEATURE_LIFECYCLE_FORMAT,version:lifecycle.FEATURE_LIFECYCLE_VERSION,
    action:'restore',expectedProjectId:h.document.projectId,expectedRevision:h.document.revision,
    featureIds:[featureId],eventIds:[`workbench.restore.${h.document.revision}.${featureId}`],
    admission:'permit_unresolved',
  };
  return lifecycle.commitUndoableFeatureRestoration(h,request);
}
export type ModelDimension = 'width' | 'depth' | 'holeDiameter' | 'holePitch' | 'thickness';
export const MODEL_DIMENSIONS: readonly ModelDimension[] = ['width', 'depth', 'holeDiameter', 'holePitch', 'thickness'];
export type ModelHole = string;
export type ModelHoleField = 'x' | 'y' | 'diameter';
export type ModelHoleDimensions = Readonly<{x:number;y:number;diameter:number}>;

function requireHole(h:ModelSession,hole:ModelHole):void {
  if(!sketchSource(h).circles.some(c=>c.id===hole))
    throw Error('Unknown authoritative sketch hole: '+hole);
}

/** A legacy hole has a directly editable fixed centre and radius. Relative
 * edge-anchored holes must instead use the selected-contour RUNTIME editor. */
export function modelHoleIsCartesian(h: ModelSession, hole: ModelHole): boolean {
  const source = sketchSource(h);
  const centre = source.constraints.find(c=>c.id===hole+':fixed');
  return source.circles.some(c=>c.id===hole) && centre?.kind==='fixed' &&
    source.constraints.some(c=>c.kind==='radius'&&c.circle===hole);
}

/** Read real solved SKETCH centres (never preview triangles or cached mesh).
 * For an invalid/unsolved sketch, retain authored seed coordinates ONLY as
 * editable diagnostics; the separate RuntimeReport marks geometry unresolved.
 * Relative edge holes have distanceX/Y anchors, not fabricated fixed centres. */
export function modelHoleValues(h: ModelSession): Record<ModelHole, ModelHoleDimensions> {
  const source = sketchSource(h), constraints = source.constraints;
  const requiresSolve = source.circles.some(c=>!modelHoleIsCartesian(h,c.id));
  const solution = requiresSolve ? sketch.solveSketch(source) : null;
  const read = (circle: SketchDocument['circles'][number]): ModelHoleDimensions => {
    const hole=circle.id, fixed=constraints.find(c=>c.id===hole+':fixed');
    const authored=source.points.find(p=>p.id===circle.center);
    const solved=solution?.status==='solved'
      ?solution.geometry?.points.find(p=>p.id===circle.center):null;
    const point=fixed?.kind==='fixed'?fixed:solved??authored;
    const radius=constraints.find(c=>c.kind==='radius'&&c.circle===hole);
    if(!point||!radius||radius.kind!=='radius')
      throw Error('Missing authored sketch circle/constraints: '+hole);
    return {x:point.x,y:point.y,diameter:radius.value*2};
  };
  return Object.fromEntries(source.circles.map(c=>[c.id,read(c)]));
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

/** One undoable, revision-fenced operation on selected authored hole IDs.
 * The stationary pivot is the selected hole-centre bounding-box midpoint.
 * RUNTIME owns all physical profile and SKETCH solver admission. */
export interface ModelHoleLayoutScale {
  readonly holeIds: readonly ModelHole[];
  readonly scaleX: number;
  readonly scaleY: number;
  readonly radiusScale: number;
}
export function resizeModelHoleLayout(
  h:ModelSession, request:ModelHoleLayoutScale,
):SketchConstraintBatchResult {
  const ids=request.holeIds;
  if(!ids.length || ids.length>32 || new Set(ids).size!==ids.length)
    throw Error('Select 1–32 distinct holes for one layout edit.');
  const values=modelHoleValues(h);
  for(const id of ids) if(!Object.hasOwn(values,id))
    throw Error('Unknown authored hole in layout selection: '+id);
  if(![request.scaleX,request.scaleY,request.radiusScale].every(
    value=>Number.isFinite(value)&&value>0&&value<=10))
    throw Error('Layout scaling must be finite and between 0% and 1000%.');
  if([request.scaleX,request.scaleY,request.radiusScale].every(value=>value===1))
    throw Error('No hole layout dimension changed.');
  const selected=ids.map(id=>values[id]);
  const xs=selected.map(v=>v.x),ys=selected.map(v=>v.y);
  return runtime.resizePlateHoleLayout(h,{
    sketchFeatureId:'sketch.plate',
    eventId:`workbench.hole.layout.${h.document.revision}`,
    expectedRevision:h.document.revision,
    admission:'require_admissible',
    holeIds:ids,
    pivotXmm:(Math.min(...xs)+Math.max(...xs))/2,
    pivotYmm:(Math.min(...ys)+Math.max(...ys))/2,
    scaleX:request.scaleX,scaleY:request.scaleY,radiusScale:request.radiusScale,
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

/** Translate an explicitly selected set of authored circles in a single
 * revision-fenced SKETCH edit.  A partial move is never published: the solver
 * admits the entire translated group or retains the original journal. */
export function moveModelHoleGroup(
  h: ModelSession, holeIds: readonly ModelHole[], deltaX: number, deltaY: number,
): SketchConstraintBatchResult {
  if (holeIds.length < 2 || holeIds.length > 32 || new Set(holeIds).size !== holeIds.length)
    throw Error('Group drag requires 2–32 distinct authored holes.');
  if (![deltaX, deltaY].every(Number.isFinite) || (deltaX === 0 && deltaY === 0))
    throw Error('Group drag requires a finite, nonzero translation.');
  const holes = modelHoleValues(h);
  const admitted = previewModelSketchProfile(runtime.inspect(h));
  if (!admitted) throw Error('Group drag requires a currently admitted solved sketch profile.');
  // This workbench currently authors an axis-aligned rectangular plate. The
  // SKETCH solver can satisfy the constraints of a circle whose entire rim
  // moved outside that plate, so a direct physical-hole drag additionally
  // verifies the requested rim against the actual admitted plate bounds.
  // This is a conservative UI admission fence, not a replacement solver.
  const minX = Math.min(...admitted.outer.map(p => p.x));
  const maxX = Math.max(...admitted.outer.map(p => p.x));
  const minY = Math.min(...admitted.outer.map(p => p.y));
  const maxY = Math.max(...admitted.outer.map(p => p.y));
  const edits = holeIds.map(id => {
    const origin = holes[id];
    if (!origin) throw Error('Unknown authored hole in group drag: ' + id);
    const x = origin.x + deltaX, y = origin.y + deltaY;
    if (![x, y].every(value => Number.isFinite(value) && Math.abs(value) <= 10000))
      throw Error('Group drag target lies outside the supported coordinate range.');
    const circle = admitted.holes.find(hole => hole.id === id);
    if (!circle) throw Error('Selected hole is absent from the admitted profile: ' + id);
    if (x - circle.radius <= minX || x + circle.radius >= maxX ||
        y - circle.radius <= minY || y + circle.radius >= maxY)
      throw Error('Group translation would invalidate the solved SKETCH profile; no edit committed.');
    return {constraintId: id + ':fixed', patch: {x, y}};
  });
  const result = runtime.editSketchConstraints(h, {
    sketchFeatureId: 'sketch.plate',
    eventId: `workbench.drag.group.${h.document.revision}`,
    expectedRevision: h.document.revision,
    admission: 'require_admissible',
    edits,
  });
  // The runtime may accept solved constraints while profile discovery finds
  // that a circle has crossed the plate boundary. A drag must be usable, not
  // just solvable: refuse that candidate before exposing its new history.
  if (result.kind === 'committed' &&
      !previewModelSketchProfile(runtime.inspect(result.history)))
    throw Error('Group translation would invalidate the solved SKETCH profile; no edit committed.');
  return result;
}

/** Direct gestures require physical clearance, not merely solvable constraints.
 * The current editor admits only the actual orthogonal plate, never an
 * arbitrary-contour bounding-box approximation. */
function assertInsidePlate(h:ModelSession,hole:ModelHole,x:number,y:number):void {
  const profile=previewModelSketchProfile(runtime.inspect(h));
  if(!profile)throw Error('Direct hole movement requires an admitted solved profile.');
  const xs=profile.outer.map(p=>p.x),ys=profile.outer.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  const corners=new Set(profile.outer.map(p=>p.x+','+p.y));
  if(profile.outer.length!==4||corners.size!==4||
      ![minX,maxX,minY,maxY].every(Number.isFinite)||
      minX>=maxX||minY>=maxY||
      profile.outer.some(p=>(p.x!==minX&&p.x!==maxX)||(p.y!==minY&&p.y!==maxY)))
    throw Error('Direct hole movement requires an admitted rectangular plate.');
  const rim=profile.holes.find(circle=>circle.id===hole);
  if(!rim||!Number.isFinite(rim.radius)||rim.radius<=0)
    throw Error('Selected hole missing from the admitted sketch profile.');
  if(x-rim.radius<=minX||x+rim.radius>=maxX||
      y-rim.radius<=minY||y+rim.radius>=maxY)
    throw Error('Direct hole movement would place its rim outside the plate; model unchanged.');
}

/** One direct gesture changes both coordinates in one undoable SKETCH event.
 * Numeric inspector edits separately preserve unresolved intent for repair. */
export function moveModelHoleCenter(
  h:ModelSession, hole:ModelHole, x:number,y:number,
):SketchConstraintBatchResult {
  requireHole(h,hole);
  if (![x,y].every(v=>Number.isFinite(v)&&Math.abs(v)<=10000))
    throw Error('Hole drag coordinates are out of supported range');
  assertInsidePlate(h,hole,x,y);
  const result=runtime.editSketchConstraints(h,{
    sketchFeatureId:'sketch.plate',eventId:`workbench.drag.${hole}.${h.document.revision}`,
    expectedRevision:h.document.revision,admission:'require_admissible',
    edits:[{constraintId:hole+':fixed',patch:{x,y}}],
  });
  if(result.kind==='committed'){
    const actual=modelHoleValues(result.history)[hole];
    if(!actual||Math.abs(actual.x-x)>1e-6||Math.abs(actual.y-y)>1e-6)
      throw Error('Direct hole movement missed its solved target; model unchanged.');
    assertInsidePlate(result.history,hole,actual.x,actual.y);
  }
  return result;
}

/** One or several selected hole centres move per key press as one INTENT event. */
export function nudgeModelHoleSelection(
  h:ModelSession,holeIds:readonly ModelHole[],deltaX:number,deltaY:number,
):SketchConstraintBatchResult {
  if(!Array.isArray(holeIds)||holeIds.length<1||holeIds.length>32||
      new Set(holeIds).size!==holeIds.length)
    throw Error('Nudge requires 1–32 distinct selected authored holes.');
  if(![deltaX,deltaY].every(Number.isFinite)||
      [deltaX,deltaY].some(n=>Math.abs(n)>10000)||
      (deltaX===0&&deltaY===0))
    throw Error('Nudge requires a finite nonzero X/Y step within ±10,000 mm.');
  const positions=modelHoleValues(h);
  for(const id of holeIds)
    if(!Object.hasOwn(positions,id))
      throw Error('Nudge selection contains an unknown authored hole: '+id);
  if(holeIds.length>1)return moveModelHoleGroup(h,holeIds,deltaX,deltaY);
  const id=holeIds[0];
  return moveModelHoleCenter(h,id,positions[id].x+deltaX,positions[id].y+deltaY);
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

/** Begin with one authoritative solved SKETCH feature and no manufactured solid.
 * Unlike the complete mounting-plate example, the user authors extrusion and
 * cut separately. The profile contains two circular construction candidates;
 * neither is a solid cut until the user commits the cut feature. */
/** Truly empty solver-owned sketch source: no template vertices, edges or holes. */
export function newModelEmptySketchSession(projectId = 'workbench.empty.one'): ModelSession {
  const empty=sketch.validateSketch({
    version:1,units:'mm',points:[],lines:[],circles:[],constraints:[],
  });
  const seeded=runtime.commit(initial(projectId),[
    created('create.empty.sketch',feature('sketch.plate','sketch',[],[],
      {sketch:empty as unknown as model.JsonValue})),
  ]);
  return transactions.startUndoHistory(seeded.document);
}

/** Generic drawn contours do not have the historical fixture's dimension IDs. */
export function modelSketchHasPlateDimensions(h:ModelSession):boolean {
  const ids=new Set(sketchSource(h).constraints.map(c=>c.id));
  return ['width','height','holeA:fixed','holeB:fixed',
    'holeA:diameter'].every(id=>ids.has(id));
}
export function modelSketchIsEmpty(h:ModelSession):boolean {
  const source=sketchSource(h);
  return !source.points.length&&!source.lines.length&&!source.circles.length&&
    !source.constraints.length;
}
export function modelCurrentSketch(h:ModelSession):SketchDocument {
  return sketchSource(h);
}

export function newModelSketchSession(projectId = 'workbench.sketch.one'): ModelSession {
  const seeded=runtime.commit(initial(projectId), [
    created('create.sketch', feature('sketch.plate', 'sketch', [], [],
      { sketch: sketch.plateSketchFixture() as unknown as model.JsonValue })),
  ]);
  // The new-project template is a baseline, not an undoable user edit:
  // undoing it would remove the workbench's only source sketch and strand
  // numeric tools that correctly require an active SKETCH feature.
  return transactions.startUndoHistory(seeded.document);
}

/** Commit an actual body-producing extrusion to the INTENT journal.
 * Restoring a removed extrusion retains its existing semantic identity. */
export function createModelExtrusion(h: ModelSession, thicknessMm: number): ModelSession {
  if (!Number.isFinite(thicknessMm) || thicknessMm<=0 || thicknessMm>10000)
    throw Error('Extrusion thickness must be finite and positive (up to 10,000 mm).');
  const profile=previewModelSketchProfile(runtime.inspect(h));
  if(!profile) throw Error('The sketch has no admitted solved profile for extrusion.');
  const existing=modelFeatureTimeline(h).find(f=>f.featureId==='plate');
  if(existing?.active) throw Error('An extrusion already exists in this project.');
  if(existing) throw Error('Extrusion was removed; select its tombstone and restore it without changing its authored dimension.');
  return runtime.commit(h,[
    created(`workbench.extrude.${h.document.revision}`,feature('plate','extrude',
      ['sketch.plate'],['body.plate'],{sourceSketchId:'sketch.plate',thicknessMm})),
  ],h.document.revision);
}

/** Create an explicitly body-targeted circular through-cut from the already
 * admitted SKETCH profile. This is semantic intent, not a native Boolean. */
export function createModelThroughCut(h: ModelSession): ModelSession {
  const report=runtime.inspect(h);
  if(!modelFeatureTimeline(h).some(f=>f.featureId==='plate'&&f.active) ||
      report.features.find(f=>f.featureId==='plate')?.status!=='preview_only')
    throw Error('Create an admitted extrusion before cutting this body.');
  if(!previewModelSketchProfile(report)?.holes.length)
    throw Error('Add a solved circular hole before committing the cut.');
  const existing=modelFeatureTimeline(h).find(f=>f.featureId==='cut');
  if(existing?.active) throw Error('A cut already exists in this project.');
  if(existing) throw Error('Cut was removed; restore its original semantic feature instead of duplicating the body operation.');
  return runtime.commit(h,[
    created(`workbench.cut.${h.document.revision}`,feature('cut','cut',
      ['plate'],['body.plate'],
      {sourceSketchId:'sketch.plate',targetBodyId:'body.plate'})),
  ],h.document.revision);
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

/** Read the linked parameter's stable ID, visible label and literal value
 * directly from the INTENT journal; never maintain duplicate UI authority. */
export interface NamedThicknessParameter {
  readonly featureId:string;
  readonly name:string;
  readonly valueMm:number;
  readonly literalEditable:boolean;
}
export function inspectNamedThicknessParameter(h:ModelSession):NamedThicknessParameter|null {
  if(modelThicknessBinding(h)!=='named_parameter')return null;
  const source=getFeature(h,'parameter.t');
  const raw=source.payload.parameter;
  if(source.kind!=='parameter'||!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('Missing authoritative named thickness parameter');
  const parameter=raw as Record<string,unknown>;
  if(typeof parameter.name!=='string')throw Error('Authoritative parameter name is invalid');
  const expression=parameter.expression;
  const literal=!!expression&&typeof expression==='object'&&!Array.isArray(expression)
    ?expression as Record<string,unknown>:null;
  return {
    featureId:source.id,name:parameter.name,valueMm:modelDimensionValues(h).thickness,
    literalEditable:literal?.op==='literal'&&literal.unit==='mm'&&
      typeof literal.value==='number'&&Number.isFinite(literal.value),
  };
}
/** One accepted INTENT revision-fenced event for a name and/or value change. */
export function editNamedThicknessParameter(h:ModelSession,name:string,valueMm:number):ModelSession {
  const current=inspectNamedThicknessParameter(h);
  if(!current||!current.literalEditable)
    throw Error('No editable literal named thickness parameter is bound to this extrusion.');
  if(!Number.isFinite(valueMm)||valueMm<=0||valueMm>10000)
    throw Error('Named thickness must be finite and positive (up to 10,000 mm).');
  return commitUndoableParameterInspectorEdit(h,{
    format:PARAMETER_INSPECTOR_FORMAT,version:PARAMETER_INSPECTOR_VERSION,
    eventId:`workbench.parameter.edit.${h.document.revision}`,
    featureId:current.featureId,expectedProjectId:h.document.projectId,
    expectedRevision:h.document.revision,name,
    expression:{op:'literal',value:valueMm,unit:'mm'},
    admission:'require_admissible',
  });
}

/** An editable spreadsheet row reflects the living authoritative INTENT DAG. */
export interface ModelParameterFormulaRow {
  readonly featureId:string;
  readonly name:string;
  readonly formula:string;
  readonly unit:ParameterUnit;
  readonly value:number|null;
  readonly status:string;
  readonly diagnostics:readonly string[];
}

export function modelParameterFormulaRows(h:ModelSession):readonly ModelParameterFormulaRow[] {
  const evaluation=evaluateParameterPlan(model.planProject(h.document));
  const values=new Map(evaluation.parameterValues.map(x=>[x.featureId,x.value]));
  const gates=new Map(evaluation.featureGates.map(x=>[x.featureId,x]));
  return model.featuresOf(h.document).filter(f=>f.kind==='parameter').map(feature=>{
    const source=feature.payload.parameter;
    if(!source||typeof source!=='object'||Array.isArray(source))
      throw Error('Malformed authored parameter: '+feature.id);
    const parameter=source as Record<string,unknown>;
    if(typeof parameter.name!=='string'||
       !['mm','deg','unitless'].includes(String(parameter.unit)))
      throw Error('Malformed parameter name/unit: '+feature.id);
    // Formatting, naming, expression parsing, and dependency resolution all
    // belong to INTENT. Never evaluate a formula with JS or derive it from UI.
    const formula=formatParameterFormula(h.document,feature.id,
      parameter.expression as ParameterExpression);
    const gate=gates.get(feature.id);
    return {
      featureId:feature.id,name:parameter.name,formula,
      unit:parameter.unit as ParameterUnit,value:values.get(feature.id)??null,
      status:gate?.status??'unready',
      diagnostics:gate?.diagnostics.map(d=>d.message)??[],
    };
  });
}

export interface ModelParameterFormulaDraft {
  readonly featureId:string;
  readonly name:string;
  readonly formula:string;
}
function formulaTableRequest(h:ModelSession,edits:readonly ModelParameterFormulaDraft[],
  expectedRevision:number) {
  if(expectedRevision!==h.document.revision)
    throw Error('Parameter sheet is stale. Refresh the current model revision.');
  const originals=new Map(modelParameterFormulaRows(h).map(row=>[row.featureId,row]));
  const seen=new Set<string>();
  const changed=edits.flatMap(row=>{
    if(seen.has(row.featureId))throw Error('Duplicate parameter sheet row');
    seen.add(row.featureId);
    const old=originals.get(row.featureId);
    if(!old)throw Error('Parameter no longer exists: '+row.featureId);
    const nameChanged=row.name!==old.name,formulaChanged=row.formula!==old.formula;
    return nameChanged||formulaChanged?[{
      eventId:`workbench.formula.table.${expectedRevision}.${seen.size}`,
      featureId:row.featureId,
      ...(nameChanged?{name:row.name}:{}),
      ...(formulaChanged?{formula:row.formula}:{}),
    }]:[];
  });
  if(!changed.length)throw Error('No parameter sheet changes to apply.');
  return {
    format:PARAMETER_FORMULA_TABLE_FORMAT,
    version:PARAMETER_FORMULA_TABLE_VERSION,
    expectedProjectId:h.document.projectId,
    expectedRevision,
    admission:'require_admissible' as const,
    rows:changed,
  };
}

/** Preview the FINAL table and invalidation without touching project history. */
export function previewModelParameterFormulaTable(
  h:ModelSession,rows:readonly ModelParameterFormulaDraft[],expectedRevision:number,
) {
  return previewParameterFormulaTableEdit(
    h.document,formulaTableRequest(h,rows,expectedRevision));
}

/** One undo frame for all named/formula edits; no partial UI row commits. */
export function commitModelParameterFormulaTable(
  h:ModelSession,rows:readonly ModelParameterFormulaDraft[],expectedRevision:number,
):ModelSession {
  return commitUndoableParameterFormulaTableEdit(
    h,formulaTableRequest(h,rows,expectedRevision));
}

/**
 * Keep the authored BASE, draft and CURRENT journal separate. INTENT is the
 * only authority for ancestry, conflict identity, semantic formula bindings
 * and final admission; WORKBENCH never mutates an old draft to fake a rebase.
 */
export function inspectModelParameterFormulaRecovery(
  base:ModelSession,current:ModelSession,
  rows:readonly ModelParameterFormulaDraft[],
) {
  return rebaseParameterSheetEdit(base.document,current.document,
    formulaTableRequest(base,rows,base.document.revision),current.document.revision);
}

export function resolveModelParameterFormulaRecovery(
  base:ModelSession,current:ModelSession,
  rows:readonly ModelParameterFormulaDraft[],
  approvals:readonly ParameterSheetConflictApproval[],
  eventReplacements:readonly ParameterSheetEventReplacement[],
):ParameterSheetResolutionResult {
  return resolveParameterSheetConflict(base.document,current.document,
    formulaTableRequest(base,rows,base.document.revision),{
      format:PARAMETER_SHEET_RESOLUTION_FORMAT,
      version:PARAMETER_SHEET_RESOLUTION_VERSION,
      expectedProjectId:base.document.projectId,
      expectedBaseRevision:base.document.revision,
      expectedCurrentRevision:current.document.revision,
      approvals,eventReplacements,
    });
}

/** A recovered preview is NOT a commit. An additional exact-current-revision
 * fence remains mandatory, even after the user explicitly approves conflicts. */
export function commitResolvedModelParameterFormulaRecovery(
  current:ModelSession,recovery:ParameterSheetResolutionResult,
):ModelSession {
  if(recovery.status!=='ready'||!recovery.resolvedRequest||!recovery.preview||
    recovery.projectId!==current.document.projectId||
    recovery.currentRevision!==current.document.revision)
    throw Error('Parameter recovery is unapproved or stale; review the current model again.');
  return commitUndoableParameterFormulaTableEdit(current,recovery.resolvedRequest);
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

/** Source-sketch dimensions remain editable before an extrusion exists. */
export function modelSketchDimensionValues(h: ModelSession): Record<Exclude<ModelDimension,'thickness'>,number> {
  const a=dimension(h,'holeA:fixed'),b=dimension(h,'holeB:fixed');
  return {width:dimension(h,'width'),depth:dimension(h,'height'),
    holeDiameter:2*dimension(h,'holeA:diameter'),holePitch:b-a};
}

export function modelDimensionValues(h: ModelSession): Record<ModelDimension, number> {
  const a = dimension(h, 'holeA:fixed'), b = dimension(h, 'holeB:fixed');
  let value: unknown;
  if (modelThicknessBinding(h)==='named_parameter') {
    // A named CAD parameter may be an authored expression referencing other
    // semantic parameters. Read the INTENT dimension-binding evaluator, never
    // the literal AST node or an independently evaluated browser expression.
    const gate=bindings.evaluateDimensionBindingPlan(model.planProject(h.document))
      .featureGates.find(row=>row.featureId==='plate');
    value=gate?.resolvedPayload?.thicknessMm;
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
      // 3D handles and scalar inspector must preserve an authored source rename.
      const source=inspectNamedThicknessParameter(h);
      if(!source)throw Error('Bound thickness parameter missing');
      return editNamedThicknessParameter(h,source.name,value);
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

/** Public RUNTIME/SKETCH admission is already useful before any solid exists.
 * Never represent this analytic 2D profile as a proven B-rep. */
export function previewModelSketchProfile(report:RuntimeReport):PlateProfile|null {
  const source=report.features.find(f=>f.featureId==='sketch.plate');
  return source?.status==='analytic_profile_only' && source.profile?.status==='analytic_profile_only'
    ? source.profile:null;
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

/** A user operation may contain several atomic journal commands (e.g. freeze
 * + release + retire). The transaction contract needs one FRESH compensating
 * event ID for every command, but still creates just ONE undo/redo frame. */
export function undoModelSession(h: ModelSession): ModelSession {
  const frame=h.undoStack[h.undoStack.length-1];
  if (!frame) return h;
  return runtime.undo(h,frame.map((_,i)=>`undo.workbench.${h.document.revision}.${i}`));
}
export function redoModelSession(h: ModelSession): ModelSession {
  const frame=h.redoStack[h.redoStack.length-1];
  if (!frame) return h;
  return runtime.redo(h,frame.map((_,i)=>`redo.workbench.${h.document.revision}.${i}`));
}
export function serializeModelSession(h: ModelSession): string { return runtime.save(h); }
export function reopenModelSession(text: string): ModelSession {
  if (text.length > 4*1024*1024) throw Error('Model archive exceeds 4 MiB workbench limit');
  const h = runtime.reopen(text);
  // Accept a genuine authored plate/cut tombstone archive without
  // resurrecting deleted geometry; unrelated document formats are refused.
  const rows=model.featureTimelineOf(h.document);
  const active=model.featuresOf(h.document);
  const living=new Map(active.map(f=>[f.id,f]));
  const supported=(id:string):boolean=>{
    if(['sketch.plate','plate','cut'].includes(id))return true;
    const f=living.get(id);
    if(f?.kind==='parameter')return true;
    // The Workbench accepts only FEATUREOPS-authored local_xy profile solids
    // anchored to its one source sketch. RUNTIME still validates the journal
    // and sketch on Worker import; no mesh or STEP is imported as authority.
    if(!f||f.payload.units!=='mm'||f.payload.frame!=='local_xy'||
       f.writeTargets.length!==1||f.payload.sourceSketchId!=='sketch.plate')
      return false;
    if(f.kind==='extrude')
      return f.dependsOn.length===1&&f.dependsOn[0]==='sketch.plate'&&
        typeof f.payload.thicknessMm==='number'&&
        Number.isFinite(f.payload.thicknessMm)&&f.payload.thicknessMm>0;
    if(f.kind==='cut'){
      if(typeof f.payload.targetBodyId!=='string'||
         f.payload.targetBodyId!==f.writeTargets[0])return false;
      return f.dependsOn.some(parent=>{
        const writer=living.get(parent);
        return writer?.kind==='extrude'&&writer.writeTargets.length===1&&
          writer.writeTargets[0]===f.writeTargets[0];
      });
    }
    return false;
  };
  if(!rows.some(t=>t.featureId==='sketch.plate'&&t.active) ||
      rows.some(t=>t.active&&!supported(t.featureId)))
    throw Error('Archive contains unsupported sketch/feature history.');
  // Additional named INTENT parameters are safe semantic sources, not a new
  // unsupported solid/mesh. Keep the rest of this plate workbench's bounded
  // feature inventory while preserving genuine multi-row archive history.
  modelHoleValues(h);
  // A genuine user-drawn contour is not obliged to contain seeded fixture IDs.
  if(modelSketchHasPlateDimensions(h)) {
    modelSketchDimensionValues(h);
    if(rows.some(t=>t.featureId==='plate'&&t.active))modelDimensionValues(h);
  }
  runtime.inspect(h);
  return h;
}
