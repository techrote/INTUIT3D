/** One source-fenced consumer of the stacked SKETCH #342 / RUNTIME #343
 * tabbed-contour contract. This file never writes a browser-owned sketch. */
import * as sketch from '@intuit3d/sketch';
import {insertClosedContourTab,editTabbedContourVertex,inspectTabbedClosedContour,
  type TabbedClosedContourInspection} from '@intuit3d/sketch/closed-contour-insertion/v1';
import type {SelectedProfileSelection} from '@intuit3d/sketch/selected-profile/v1';
import type {LivePlateSession} from '@intuit3d/workflow-runtime/live-plate-session';
import {inspectModelClosedContour} from './closedContourBridge.ts';
import {inspectModelContourEdges} from './closedContourEdgeBridge.ts';
import {modelCurrentSketch,serializeModelSession,
  type ModelSession} from './runtimeSession.ts';
import type {SketchLocalPoint} from './blankContourDraft.ts';

type Refusal=Readonly<{kind:'refused';code:string;reason:string}>;
export type TabbedContourEdit=Readonly<{kind:'committed';history:ModelSession;
  selection:SelectedProfileSelection;tabId:string;retiredEdgeIds:readonly string[];
  createdEntityIds:readonly string[]}>|Refusal;
const refuse=(code:string,reason:string):Refusal=>({kind:'refused',code,reason});
const sourceOf=(h:ModelSession,selection:SelectedProfileSelection,archive:string)=>{
  if(serializeModelSession(h)!==archive)return null;
  const source=modelCurrentSketch(h);
  return sketch.serializeSketch(source)===selection.sourceSignature?source:null;
};
const validPoint=(p:SketchLocalPoint)=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&
  Math.max(Math.abs(p.x),Math.abs(p.y))<=10000;

export function inspectModelTabbedContour(
  h:ModelSession,selection:SelectedProfileSelection,
):TabbedClosedContourInspection|null {
  const source=modelCurrentSketch(h);
  if(sketch.serializeSketch(source)!==selection.sourceSignature)return null;
  // IDs are discovered from persistent, solver-inspected SKETCH entities after
  // reopening. UI state or historic numeric vertex indices are not authority.
  const contourIds=source.constraints.filter(c=>c.kind==='fixed'&&c.id.endsWith(':anchor'))
    .map(c=>c.id.slice(0,-':anchor'.length));
  const candidateTabs=source.lines.map(line=>/^(.*):edge:0$/.exec(line.id)?.[1])
    .filter((id):id is string=>!!id&&!contourIds.includes(id));
  const found:TabbedClosedContourInspection[]=[];
  for(const contourId of contourIds)for(const tabId of new Set(candidateTabs)){
    const inspected=inspectTabbedClosedContour(source,selection,contourId,tabId);
    if(inspected.kind==='tabbed_closed_contour')found.push(inspected);
  }
  if(found.length>1)throw Error('Ambiguous tabbed contour inventory: select a unique source profile.');
  return found[0]??null;
}

function commitTab(
  h:ModelSession,session:LivePlateSession,selection:SelectedProfileSelection,
  expectedArchive:string,operation:'insert'|'edit',
  command:ReturnType<typeof makeInsertCommand>|ReturnType<typeof makeEditCommand>,
  accepted:Extract<ReturnType<typeof insertClosedContourTab>,{kind:'accepted'}>|
    Extract<ReturnType<typeof editTabbedContourVertex>,{kind:'accepted'}>,
):TabbedContourEdit {
  const edit=session.applyCommand({
    kind:'sketch.tabbed-contour/v1',projectId:h.document.projectId,
    expectedRevision:h.document.revision,
    request:{
      format:'intuit3d.runtime.tabbed-contour-transaction',version:1,
      expectedArchive,expectedSketchSignature:command.sourceSignature,
      sketchFeatureId:'sketch.plate',eventId:'workbench.tab.'+operation+'.'+h.document.revision,
      operation,admission:'require_admissible',selection,command,acceptance:accepted,
    },
  } as Parameters<LivePlateSession['applyCommand']>[0]);
  if(edit.kind!=='committed')
    return refuse('runtime_refused',edit.reason);
  const receipt=edit.contourReceipt;
  if(!receipt||receipt.revision!==edit.history.document.revision||
      receipt.projectId!==h.document.projectId||
      receipt.contourId!==accepted.contourId||receipt.tabId!==accepted.tabId||
      receipt.nextSketchSignature!==accepted.nextSourceSignature||
      receipt.selection.sourceSignature!==accepted.selection.sourceSignature||
      JSON.stringify(receipt.selection)!==JSON.stringify(accepted.selection)||
      sketch.serializeSketch(modelCurrentSketch(edit.history))!==accepted.nextSourceSignature||
      (operation==='insert'&&!receipt.retiredEdgeIds?.includes((command as ReturnType<typeof makeInsertCommand>).edgeId)))
    throw Error('RUNTIME returned an inconsistent source-owned tab successor receipt.');
  return {kind:'committed',history:edit.history,selection:receipt.selection,
    tabId:receipt.tabId,retiredEdgeIds:receipt.retiredEdgeIds??[],
    createdEntityIds:receipt.createdEntityIds??[]};
}
function makeInsertCommand(signature:string,contourId:string,edgeId:string,
  tabId:string,vertices:readonly [SketchLocalPoint,SketchLocalPoint]) {
  return {kind:'insert-closed-contour-tab' as const,version:1 as const,
    sourceSignature:signature,contourId,edgeId,tabId,
    vertices:[{...vertices[0]},{...vertices[1]}] as [SketchLocalPoint,SketchLocalPoint]};
}
function makeEditCommand(signature:string,contourId:string,tabId:string,
  handleId:string,target:SketchLocalPoint) {
  return {kind:'edit-tabbed-contour-vertex' as const,version:1 as const,
    sourceSignature:signature,contourId,tabId,handleId,target:{...target}};
}
type AcceptedTabInsert=Extract<ReturnType<typeof insertClosedContourTab>,{kind:'accepted'}>;
type PlannedTabInsert=Readonly<{kind:'planned';command:ReturnType<typeof makeInsertCommand>;
  accepted:AcceptedTabInsert}>;

/** Read-only SKETCH admission plan; an ephemeral UI preview is NEVER an INTENT event,
 * a native B-rep or a source-bound STEP receipt. Recomputed at commit time. */
function planModelContourTab(
  h:ModelSession,selection:SelectedProfileSelection,
  edgeId:string,vertices:readonly [SketchLocalPoint,SketchLocalPoint],expectedArchive:string,
):PlannedTabInsert|Refusal {
  const source=sourceOf(h,selection,expectedArchive);
  if(!source)return refuse('stale_source','The canonical model or selected SKETCH changed. Reselect.');
  const inspected=inspectModelClosedContour(h,selection);
  const edges=inspectModelContourEdges(h,selection);
  if(!inspected||!edges?.edges.some(edge=>edge.edgeId===edgeId))
    return refuse('stale_edge','The selected edge is not a currently admitted source-owned contour edge.');
  if(vertices.length!==2||!vertices.every(validPoint))
    return refuse('invalid_vertices','Place exactly two finite sketch-local tab vertices within 10,000 mm.');
  const command=makeInsertCommand(sketch.serializeSketch(source),inspected.contourId,
    edgeId,'tab.'+h.document.revision,vertices);
  const accepted=insertClosedContourTab(source,selection,command);
  if(accepted.kind!=='accepted')
    return refuse('sketch_refused','SKETCH refused tab insertion: '+accepted.reason+
      (accepted.detail?' ('+accepted.detail+')':''));
  return {kind:'planned',command,accepted};
}

/** Preview the same source-fenced SKETCH proposal that RUNTIME must re-admit on
 * Commit. No browser-owned geometry authority, receipt or journal mutation. */
export function previewModelContourTab(
  h:ModelSession,selection:SelectedProfileSelection,
  edgeId:string,vertices:readonly [SketchLocalPoint,SketchLocalPoint],expectedArchive:string,
):Readonly<{kind:'admissible';nextSketchSignature:string;retiredEdgeId:string}>|Refusal {
  const plan=planModelContourTab(h,selection,edgeId,vertices,expectedArchive);
  if(plan.kind==='refused')return plan;
  return {kind:'admissible',nextSketchSignature:plan.accepted.nextSourceSignature,
    retiredEdgeId:edgeId};
}

export function insertModelContourTab(
  h:ModelSession,session:LivePlateSession,selection:SelectedProfileSelection,
  edgeId:string,vertices:readonly [SketchLocalPoint,SketchLocalPoint],expectedArchive:string,
):TabbedContourEdit {
  const plan=planModelContourTab(h,selection,edgeId,vertices,expectedArchive);
  if(plan.kind==='refused')return plan;
  // The preview never authorizes a commit. The plan is checked again against
  // the actual current journal and RUNTIME performs its own source/revision
  // admission before appending precisely one transaction.
  return commitTab(h,session,selection,expectedArchive,'insert',plan.command,plan.accepted);
}
export function editModelTabbedVertex(
  h:ModelSession,session:LivePlateSession,selection:SelectedProfileSelection,
  handleId:string,target:SketchLocalPoint,expectedArchive:string,
):TabbedContourEdit {
  const source=sourceOf(h,selection,expectedArchive);
  if(!source)return refuse('stale_source','The canonical model or selected SKETCH changed. Reselect.');
  const inspected=inspectModelTabbedContour(h,selection);
  if(!inspected||!inspected.handles.some(handle=>handle.handleId===handleId))
    return refuse('stale_handle','Choose an actual current tabbed contour handle.');
  if(!validPoint(target))return refuse('invalid_target','Tab vertex outside bounded sketch workspace.');
  const command=makeEditCommand(inspected.sourceSignature,inspected.contourId,
    inspected.tabId,handleId,target);
  const accepted=editTabbedContourVertex(source,selection,command);
  if(accepted.kind!=='accepted')
    return refuse('sketch_refused','SKETCH refused tab dimension: '+accepted.reason+
      (accepted.detail?' ('+accepted.detail+')':''));
  return commitTab(h,session,selection,expectedArchive,'edit',command,accepted);
}
