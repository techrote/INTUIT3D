/**
 * @intuit3d/model/body-cut-block-relocate/v1
 *
 * Relocate an explicitly selected contiguous block of 2–16 cuts in the
 * dependency-ordered history of ONE body, without changing the selected
 * cuts' internal order, profile identities, extents or authored timeline.
 * Preview, destination inventory and commit use the same admission rules.
 * Geometry, topology resolution and STEP remain provider-owned.
 */
import {
  featuresOf, parseProject, planProject, serializeProject,
  ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type { EvaluationPlan, Feature, JournalEvent, ProjectDocument } from './index.ts';
import { inspectBodyCutChain } from './body-cut-chain.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { TOPOLOGY_REFERENCE_FORMAT } from './topology.ts';

export const BODY_CUT_BLOCK_RELOCATE_FORMAT = 'intuit3d.body-cut-block-relocate' as const;
export const BODY_CUT_BLOCK_RELOCATE_VERSION = 1 as const;
export const BODY_CUT_BLOCK_DESTINATIONS_FORMAT = 'intuit3d.body-cut-block-destinations' as const;

export interface BodyCutBlockRelocateSelection {
  readonly format: typeof BODY_CUT_BLOCK_RELOCATE_FORMAT;
  readonly version: typeof BODY_CUT_BLOCK_RELOCATE_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  /** Canonical journal snapshot, including equal-revision branch divergence. */
  readonly expectedDocumentFence: string;
  readonly targetBodyId: string;
  /** 2–16 consecutive cuts in current BODY dependency order. */
  readonly cutFeatureIds: readonly string[];
}
export interface BodyCutBlockRelocateRequest extends BodyCutBlockRelocateSelection {
  /** Existing body writer outside the block; never a transient face index. */
  readonly afterBodyWriterId: string;
  /** Exactly 2 or 3 fresh event IDs, as prescribed by destination inspection. */
  readonly eventIds: readonly string[];
}
export interface BodyCutBlockRelocatePreview {
  readonly format: 'intuit3d.body-cut-block-relocate-preview';
  readonly version: 1;
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly writerOrderBefore: readonly string[];
  readonly writerOrderAfter: readonly string[];
  readonly rewiredWriterIds: readonly string[];
  readonly invalidatedBodyIds: readonly string[];
  readonly cutFeatureIds: readonly string[];
  readonly authoredTimelineChanged: false;
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}
export interface BodyCutBlockDestinationsRequest extends BodyCutBlockRelocateSelection {
  readonly offset: number;
  readonly limit: number;
}
export interface BodyCutBlockDestination {
  readonly afterBodyWriterId: string;
  readonly eligibility: 'available' | 'blocked' | 'current';
  readonly proposedWriterOrder: readonly string[];
  readonly requiredEventIds: number;
  readonly rewiredWriterIds: readonly string[];
  readonly invalidatedBodyIds: readonly string[];
  readonly diagnostic: string | null;
}
export interface BodyCutBlockDestinationsInventory {
  readonly format: typeof BODY_CUT_BLOCK_DESTINATIONS_FORMAT;
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly targetBodyId: string;
  readonly cutFeatureIds: readonly string[];
  readonly writerOrderBefore: readonly string[];
  readonly totalDestinations: number;
  readonly offset: number;
  readonly limit: number;
  readonly nextOffset: number | null;
  readonly destinations: readonly BodyCutBlockDestination[];
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const BASE_FIELDS = [
  'format','version','expectedProjectId','expectedRevision',
  'expectedDocumentFence','targetBodyId','cutFeatureIds',
] as const;
function fail(reason: string): never {
  throw new ProjectFormatError('body cut block relocate: ' + reason);
}
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
function id(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}
function selection(
  input: ProjectDocument, request: unknown, extra: readonly string[],
): { doc: ProjectDocument; chain: Feature[]; indices: readonly number[] } {
  if (!record(request) || !exact(request, [...BASE_FIELDS, ...extra]) ||
      request.format !== BODY_CUT_BLOCK_RELOCATE_FORMAT ||
      request.version !== BODY_CUT_BLOCK_RELOCATE_VERSION ||
      !id(request.expectedProjectId) ||
      !Number.isSafeInteger(request.expectedRevision) ||
      typeof request.expectedDocumentFence !== 'string' ||
      !id(request.targetBodyId) ||
      !Array.isArray(request.cutFeatureIds) ||
      request.cutFeatureIds.length < 2 || request.cutFeatureIds.length > 16 ||
      !request.cutFeatureIds.every(id) ||
      new Set(request.cutFeatureIds).size !== request.cutFeatureIds.length) {
    fail('invalid versioned selection or unknown fields');
  }
  const doc = parseProject(input);
  if (request.expectedProjectId !== doc.projectId ||
      request.expectedRevision !== doc.revision ||
      request.expectedDocumentFence !== serializeProject(doc)) {
    throw new ProjectRevisionError('body cut block relocate: stale document fence');
  }
  const inspected = inspectBodyCutChain(doc, request.targetBodyId);
  if (inspected.status !== 'ready') {
    fail(inspected.diagnostic ?? 'body has no ready dependency-ordered terminal');
  }
  const writers = featuresOf(doc).filter((f) =>
    f.writeTargets.includes(request.targetBodyId as string));
  if (writers.length < 3 || writers.length > 129) {
    fail('requires one extrusion and 2–128 ordered body cuts');
  }
  const byId = new Map(writers.map((f) => [f.id, f] as const));
  const followers = new Map<string, Feature>();
  let root: Feature | undefined;
  for (const writer of writers) {
    if (writer.writeTargets.length !== 1 ||
        writer.writeTargets[0] !== request.targetBodyId ||
        (writer.kind !== 'extrude' && writer.kind !== 'cut') ||
        (writer.kind === 'cut' && writer.payload.targetBodyId !== request.targetBodyId)) {
      fail('unsupported or multi-target body writer');
    }
    const previous = writer.dependsOn.filter((dep) => byId.has(dep));
    if (previous.length === 0) {
      if (root || writer.kind !== 'extrude') fail('requires one extrusion root');
      root = writer;
    } else {
      if (writer.kind !== 'cut' || previous.length !== 1 ||
          followers.has(previous[0]!)) {
        fail('requires one unbranched cut writer chain');
      }
      followers.set(previous[0]!, writer);
    }
  }
  if (!root) fail('missing extrusion root');
  const chain: Feature[] = [], seen = new Set<string>();
  let next: Feature | undefined = root;
  while (next) {
    if (seen.has(next.id)) fail('cyclic writer chain');
    seen.add(next.id);
    chain.push(next);
    next = followers.get(next.id);
  }
  if (chain.length !== writers.length ||
      chain[chain.length - 1]!.id !== inspected.eligibleAfterWriterId) {
    fail('incomplete writer chain');
  }
  const ids = chain.map((f) => f.id);
  const indices = (request.cutFeatureIds as string[]).map((featureId) =>
    ids.indexOf(featureId));
  if (indices.some((index, n) =>
    index <= 0 || index !== indices[0]! + n ||
    chain[index]!.kind !== 'cut')) {
    fail('selected cuts must be in contiguous body dependency order');
  }
  return { doc, chain, indices };
}
function propose(
  chain: readonly Feature[], ids: readonly string[], after: string,
): { order: Feature[]; rewires: { feature: Feature; from: string; to: string }[] } {
  if (!id(after)) fail('invalid destination semantic writer');
  const selected = new Set(ids);
  if (selected.has(after)) fail('destination cannot belong to moved block');
  const remaining = chain.filter((f) => !selected.has(f.id));
  const at = remaining.findIndex((f) => f.id === after);
  if (at < 0) fail('destination must belong to this body');
  const block = chain.filter((f) => selected.has(f.id));
  const order = [...remaining];
  order.splice(at + 1, 0, ...block);
  if (order.every((f, i) => f.id === chain[i]!.id)) fail('requested move is a no-op');
  const positions = new Map(order.map((f, i) => [f.id, i] as const));
  // The payload may contain independent named-edge source identities that
  // are not encoded in the immediate structural predecessor dependency.
  for (const writer of order) {
    const sources = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { for (const item of value) visit(item); return; }
      if (!record(value)) return;
      if (value.format === TOPOLOGY_REFERENCE_FORMAT &&
          record(value.anchor) && typeof value.anchor.featureId === 'string') {
        sources.add(value.anchor.featureId);
      }
      for (const item of Object.values(value)) visit(item);
    };
    visit(writer.payload);
    if (typeof writer.payload.edgeSourceWriterId === 'string') {
      sources.add(writer.payload.edgeSourceWriterId);
    }
    for (const source of sources) {
      const position = positions.get(source);
      if (position !== undefined && position >= positions.get(writer.id)!) {
        fail('authored topology on ' + writer.id +
          ' requires earlier source writer ' + source);
      }
    }
  }
  const predecessors = new Map<string, string>();
  for (let i = 1; i < chain.length; i++) {
    predecessors.set(chain[i]!.id, chain[i - 1]!.id);
  }
  const rewires: { feature: Feature; from: string; to: string }[] = [];
  for (let i = 1; i < order.length; i++) {
    const writer = order[i]!;
    const from = predecessors.get(writer.id);
    if (!from) fail('extrusion root cannot be moved');
    const to = order[i - 1]!.id;
    if (from === to) continue;
    if (!writer.dependsOn.includes(from) || writer.dependsOn.includes(to)) {
      fail('ambiguous body writer dependencies on ' + writer.id);
    }
    const anchoredToOldPredecessor = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(anchoredToOldPredecessor);
      if (!record(value)) return false;
      if (value.format === TOPOLOGY_REFERENCE_FORMAT &&
          record(value.anchor) && value.anchor.featureId === from) return true;
      return Object.values(value).some(anchoredToOldPredecessor);
    };
    if (anchoredToOldPredecessor(writer.payload)) {
      fail('authored topology still anchors ' + writer.id + ' to ' + from);
    }
    rewires.push({ feature: writer, from, to });
  }
  if (rewires.length < 2 || rewires.length > 3) {
    fail('cut block cannot be moved with 2–3 unambiguous writer rewires');
  }
  return { order, rewires };
}
function preview(
  input: ProjectDocument, request: BodyCutBlockRelocateRequest,
  selected?: ReturnType<typeof selection>,
): BodyCutBlockRelocatePreview {
  const { doc, chain } = selected ??
    selection(input, request, ['afterBodyWriterId','eventIds']);
  const { order, rewires } = propose(chain, request.cutFeatureIds, request.afterBodyWriterId);
  if (!Array.isArray(request.eventIds) ||
      request.eventIds.length !== rewires.length ||
      !request.eventIds.every(id) ||
      new Set(request.eventIds).size !== rewires.length) {
    fail('supply exactly ' + rewires.length + ' distinct fresh event IDs');
  }
  const events: JournalEvent[] = rewires.map(({feature,from,to}, i) => ({
    eventId:request.eventIds[i]!,type:'feature.edit',featureId:feature.id,
    patch:{dependsOn:feature.dependsOn.map((dep) => dep === from ? to : dep)},
  }));
  const before = planProject(doc);
  const staged = previewTransaction(doc, events, doc.revision);
  const statuses = new Map(staged.plan.features.map((row) =>
    [row.feature.id,row.status] as const));
  for (const row of before.features) {
    if (row.status === 'ready' && statuses.get(row.feature.id) !== 'ready') {
      fail('relocation regresses previously ready feature ' + row.feature.id);
    }
  }
  // Re-inspect the actual committed dependencies, never assume the generated
  // patch sequence corresponds to a ready, unbranched writer chain.
  const finished = inspectBodyCutChain(staged.document, request.targetBodyId);
  const actual = (staged.plan.executableOrder.filter((featureId) =>
    order.some((f) => f.id === featureId)));
  const desired = order.map((f) => f.id);
  if (finished.status !== 'ready' ||
      finished.eligibleAfterWriterId !== desired[desired.length - 1] ||
      actual.length !== desired.length ||
      actual.some((f, i) => f !== desired[i])) {
    fail('relocation does not preserve ready body evaluation order');
  }
  const invalidation = planIncrementalEvaluation(doc, staged.document);
  const affected = new Set(invalidation.invalidatedFeatureIds);
  const bodies = new Set<string>();
  for (const feature of featuresOf(staged.document)) {
    if (!affected.has(feature.id) ||
        (feature.kind !== 'cut' && feature.kind !== 'extrude')) continue;
    for (const target of feature.writeTargets) bodies.add(target);
  }
  return {
    format:'intuit3d.body-cut-block-relocate-preview',version:1,
    document:staged.document,events:staged.document.journal.slice(doc.revision),
    plan:staged.plan,invalidation,
    writerOrderBefore:chain.map((f) => f.id),writerOrderAfter:desired,
    rewiredWriterIds:rewires.map((x) => x.feature.id),
    invalidatedBodyIds:[...bodies],
    cutFeatureIds:[...request.cutFeatureIds],
    authoredTimelineChanged:false,requiresNativeRebuild:true,
    exactGeometryAuthority:false,
  };
}
export function previewBodyCutBlockRelocate(
  input: ProjectDocument, request: BodyCutBlockRelocateRequest,
): BodyCutBlockRelocatePreview {
  return preview(input,request);
}
export function commitUndoableBodyCutBlockRelocate(
  input: UndoHistory, request: BodyCutBlockRelocateRequest,
): UndoHistory {
  const session = parseUndoHistory(input);
  const staged = previewBodyCutBlockRelocate(session.document,request);
  return commitUndoableTransaction(session,staged.events,request.expectedRevision);
}
function freshProbeIds(doc: ProjectDocument, count: number): string[] {
  const used = new Set(doc.journal.map((event) => event.eventId));
  return Array.from({length:count},(_,i) => {
    let n = i, candidate = '';
    do { candidate = 'block.inspect.' + n++; } while(used.has(candidate));
    used.add(candidate);
    return candidate;
  });
}
/**
 * Paged, revision-fenced destinations with preview-derived diagnostics.
 * 'available' is only semantic admission. WORKBENCH must still obtain a
 * freshly fenced request and RUNTIME must execute and validate geometry.
 */
export function inspectBodyCutBlockDestinations(
  input: ProjectDocument, request: BodyCutBlockDestinationsRequest,
): BodyCutBlockDestinationsInventory {
  const { doc, chain, indices } = selection(input,request,['offset','limit']);
  if (!Number.isSafeInteger(request.offset) || request.offset < 0 ||
      !Number.isSafeInteger(request.limit) ||
      request.limit < 1 || request.limit > 16) {
    fail('offset and limit must be a nonnegative offset and 1–16 positions');
  }
  const destinations = chain.filter((f) => !request.cutFeatureIds.includes(f.id));
  if (request.offset > destinations.length) fail('offset exceeds number of destinations');
  const oldPrevious = chain[indices[0]! - 1]!.id;
  const rows: BodyCutBlockDestination[] = [];
  for (const destination of destinations.slice(request.offset,request.offset+request.limit)) {
    if (destination.id === oldPrevious) {
      rows.push({
        afterBodyWriterId:destination.id,eligibility:'current',
        proposedWriterOrder:chain.map((f) => f.id),requiredEventIds:0,
        rewiredWriterIds:[],invalidatedBodyIds:[],diagnostic:null,
      });
      continue;
    }
    const others = chain.filter((f) => !request.cutFeatureIds.includes(f.id));
    const block = chain.filter((f) => request.cutFeatureIds.includes(f.id));
    const order = [...others];
    order.splice(others.findIndex((f) => f.id === destination.id)+1,0,...block);
    try {
      const { rewires } = propose(chain,request.cutFeatureIds,destination.id);
      const candidate = preview(doc,{
        format:request.format,version:request.version,
        expectedProjectId:request.expectedProjectId,
        expectedRevision:request.expectedRevision,
        expectedDocumentFence:request.expectedDocumentFence,
        targetBodyId:request.targetBodyId,
        cutFeatureIds:request.cutFeatureIds,
        afterBodyWriterId:destination.id,
        eventIds:freshProbeIds(doc,rewires.length),
      },{doc,chain,indices});
      rows.push({
        afterBodyWriterId:destination.id,eligibility:'available',
        proposedWriterOrder:candidate.writerOrderAfter,
        requiredEventIds:candidate.events.length,
        rewiredWriterIds:candidate.rewiredWriterIds,
        invalidatedBodyIds:candidate.invalidatedBodyIds,diagnostic:null,
      });
    } catch (error) {
      if (!(error instanceof ProjectFormatError) &&
          !(error instanceof ProjectRevisionError)) throw error;
      rows.push({
        afterBodyWriterId:destination.id,eligibility:'blocked',
        proposedWriterOrder:order.map((f) => f.id),requiredEventIds:0,
        rewiredWriterIds:[],invalidatedBodyIds:[],
        diagnostic:error.message,
      });
    }
  }
  const next = request.offset + rows.length;
  return {
    format:BODY_CUT_BLOCK_DESTINATIONS_FORMAT,version:1,
    projectId:doc.projectId,revision:doc.revision,
    targetBodyId:request.targetBodyId,cutFeatureIds:[...request.cutFeatureIds],
    writerOrderBefore:chain.map((f) => f.id),
    totalDestinations:destinations.length,offset:request.offset,limit:request.limit,
    nextOffset:next < destinations.length ? next : null,
    destinations:rows,exactGeometryAuthority:false,
  };
}
