/**
 * @intuit3d/model/body-cut-relocate/v1
 *
 * Reposition a non-adjacent cut within one fully ordered body-writer chain in
 * ONE revision-fenced and undoable command. This changes actual dependency
 * execution, never just timeline presentation. Retain authored sketch/profile,
 * semantic ID, blind depth, topology roles and unrelated dependencies.
 *
 * All geometric consequences remain RUNTIME/KERNEL-owned. A model-ready cut
 * does not prove a valid Boolean, current selected edge, B-rep or STEP export.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, Feature, JournalEvent, ProjectDocument,
} from './index.ts';
import {
  previewTransaction, parseUndoHistory, commitUndoableTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { inspectBodyCutChain } from './body-cut-chain.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import { TOPOLOGY_REFERENCE_FORMAT } from './topology.ts';

export const BODY_CUT_RELOCATE_FORMAT = 'intuit3d.body-cut-relocate' as const;
export const BODY_CUT_RELOCATE_VERSION = 1 as const;

export interface BodyCutRelocateRequest {
  readonly format: typeof BODY_CUT_RELOCATE_FORMAT;
  readonly version: typeof BODY_CUT_RELOCATE_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly targetBodyId: string;
  /** Existing cut to move, keeping its authored semantic identity and payload. */
  readonly cutFeatureId: string;
  /** Existing extrusion root or another cut, never the moving cut itself. */
  readonly afterBodyWriterId: string;
  /** Exactly one fresh journal event ID per changed body-predecessor edge (2–3). */
  readonly eventIds: readonly string[];
}

export interface BodyCutRelocatePreview {
  readonly format: 'intuit3d.body-cut-relocate-preview';
  readonly version: 1;
  readonly document: ProjectDocument;
  readonly events: readonly JournalEvent[];
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly targetBodyId: string;
  readonly writerOrderBefore: readonly string[];
  readonly writerOrderAfter: readonly string[];
  /** All changed writer IDs, in new dependency execution order. */
  readonly rewiredWriterIds: readonly string[];
  /** All structurally invalidated body targets, including cross-body consumers. */
  readonly invalidatedBodyIds: readonly string[];
  readonly authoredTimelineChanged: false;
  readonly exactGeometryAuthority: false;
  readonly requiresNativeRebuild: true;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(message: string): never {
  throw new ProjectFormatError('body cut relocate: ' + message);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exact(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name));
}
function validId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid ' + label);
}
function bodyWriter(feature: Feature, bodyId: string): boolean {
  return feature.writeTargets.length === 1 &&
    feature.writeTargets[0] === bodyId &&
    (feature.kind === 'extrude' ||
      (feature.kind === 'cut' && feature.payload.targetBodyId === bodyId));
}

/** Accept only a single, unbranched extrusion-to-cuts dependency chain. */
function writerChain(document: ProjectDocument, bodyId: string): Feature[] {
  const inspection = inspectBodyCutChain(document, bodyId);
  if (inspection.status !== 'ready') {
    fail(inspection.diagnostic ?? 'body has no ready terminal writer');
  }
  const writers = featuresOf(document).filter((f) => f.writeTargets.includes(bodyId));
  if (writers.length < 3 || writers.length > 129) {
    fail('body requires an extrusion and 2–128 explicitly ordered cuts');
  }
  const ids = new Set(writers.map((f) => f.id));
  let root: Feature | undefined;
  const followers = new Map<string, Feature>();
  for (const writer of writers) {
    if (!bodyWriter(writer, bodyId)) fail('unsupported or multi-target body writer');
    const previous = writer.dependsOn.filter((dep) => ids.has(dep));
    if (previous.length === 0) {
      if (root || writer.kind !== 'extrude') fail('requires one extrusion root');
      root = writer;
    } else {
      if (writer.kind !== 'cut' || previous.length !== 1) {
        fail('cut requires exactly one explicit body predecessor');
      }
      if (followers.has(previous[0]!)) fail('branched body-writer dependencies');
      followers.set(previous[0]!, writer);
    }
  }
  if (!root) fail('missing extrusion root');
  const chain: Feature[] = [], seen = new Set<string>();
  let next: Feature | undefined = root;
  while (next) {
    if (seen.has(next.id)) fail('cyclic body writers');
    seen.add(next.id);
    chain.push(next);
    next = followers.get(next.id);
  }
  if (chain.length !== writers.length ||
      chain[chain.length - 1]?.id !== inspection.eligibleAfterWriterId) {
    fail('incomplete body-writer chain');
  }
  return chain;
}

/**
 * Preserve references which independently bind a cut to its old predecessor.
 * They cannot be made into references to the NEW predecessor by rewiring the
 * structural body-writer edge. Search nested payloads, not only top-level fields.
 */
function refersToTopologyWriter(value: unknown, writerId: string): boolean {
  if (Array.isArray(value)) return value.some((v) => refersToTopologyWriter(v, writerId));
  if (!plain(value)) return false;
  if (value.format === TOPOLOGY_REFERENCE_FORMAT && plain(value.anchor) &&
      value.anchor.featureId === writerId) return true;
  return Object.values(value).some((v) => refersToTopologyWriter(v, writerId));
}

/**
 * Move one cut to any other position on the same body, in at most three
 * dependency rewrites rather than a sequence of individual swap/undo frames.
 * A dependent projected sketch, non-chain writer, topology anchor or new
 * dependency cycle blocks the entire change; no repair is guessed.
 */
export function previewBodyCutRelocate(
  input: ProjectDocument, request: BodyCutRelocateRequest,
): BodyCutRelocatePreview {
  const doc = parseProject(input);
  if (!plain(request) || !exact(request, [
    'format','version','expectedProjectId','expectedRevision','targetBodyId',
    'cutFeatureId','afterBodyWriterId','eventIds',
  ]) || request.format !== BODY_CUT_RELOCATE_FORMAT ||
      request.version !== BODY_CUT_RELOCATE_VERSION) {
    fail('unsupported request format or fields');
  }
  for (const [label, value] of [
    ['project ID',request.expectedProjectId], ['body ID',request.targetBodyId],
    ['cut ID',request.cutFeatureId], ['preceding writer ID',request.afterBodyWriterId],
  ] as const) validId(value, label);
  if (request.expectedProjectId !== doc.projectId ||
      request.expectedRevision !== doc.revision) {
    throw new ProjectRevisionError('body cut relocate: stale project or revision');
  }
  if (request.cutFeatureId === request.afterBodyWriterId) {
    fail('a cut cannot precede itself');
  }
  const original = writerChain(doc, request.targetBodyId);
  const oldIds = original.map((f) => f.id);
  const moving = original.find((f) => f.id === request.cutFeatureId);
  if (!moving || moving.kind !== 'cut' ||
      !oldIds.includes(request.afterBodyWriterId)) {
    fail('selected cut and preceding writer must belong to the same ordered body');
  }
  const reordered = original.filter((f) => f.id !== moving.id);
  const insertion = reordered.findIndex((f) => f.id === request.afterBodyWriterId);
  reordered.splice(insertion + 1, 0, moving);
  const newIds = reordered.map((f) => f.id);
  if (newIds.every((id, i) => id === oldIds[i])) fail('requested move is a no-op');

  // A non-immediate historical writer can be an explicitly selected edge
  // source. Structural rewiring alone would leave its topology identity in
  // the payload while placing the consumer BEFORE that source. Validate every
  // local writer, not just those whose immediate predecessor edge changed.
  const positions = new Map(newIds.map((id, index) => [id, index] as const));
  for (const writer of reordered) {
    const sources = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      if (!plain(value)) return;
      if (value.format === TOPOLOGY_REFERENCE_FORMAT && plain(value.anchor) &&
          typeof value.anchor.featureId === 'string') {
        sources.add(value.anchor.featureId);
      }
      for (const entry of Object.values(value)) visit(entry);
    };
    visit(writer.payload);
    // selected-edge-cut/v1 also persists its explicit source writer ID.
    if (typeof writer.payload.edgeSourceWriterId === 'string') {
      sources.add(writer.payload.edgeSourceWriterId);
    }
    for (const source of sources) {
      const sourcePosition = positions.get(source);
      if (sourcePosition !== undefined && sourcePosition >= positions.get(writer.id)!) {
        fail('authored topology on ' + writer.id +
          ' requires earlier source writer ' + source);
      }
    }
  }


  const oldPrevious = new Map<string, string>();
  for (let i = 1; i < original.length; i++) {
    oldPrevious.set(original[i]!.id, original[i - 1]!.id);
  }
  const changes: { feature: Feature; from: string; to: string }[] = [];
  for (let i = 1; i < reordered.length; i++) {
    const feature = reordered[i]!;
    const from = oldPrevious.get(feature.id);
    const to = reordered[i - 1]!.id;
    if (!from) fail('only cuts may change body predecessors');
    if (from !== to) changes.push({ feature, from, to });
  }
  if (changes.length < 2 || changes.length > 3 ||
      !Array.isArray(request.eventIds) ||
      request.eventIds.length !== changes.length ||
      new Set(request.eventIds).size !== changes.length) {
    fail('supply exactly ' + changes.length + ' distinct fresh journal event IDs');
  }
  for (const eventId of request.eventIds) validId(eventId, 'event ID');
  const events: JournalEvent[] = changes.map(({feature,from,to}, index) => {
    if (refersToTopologyWriter(feature.payload, from)) {
      fail('authored topology still anchors ' + feature.id + ' to ' + from);
    }
    if (!feature.dependsOn.includes(from) || feature.dependsOn.includes(to)) {
      fail('ambiguous predecessor dependencies on ' + feature.id);
    }
    return {
      eventId:request.eventIds[index]!,type:'feature.edit',featureId:feature.id,
      patch:{dependsOn:feature.dependsOn.map((id) => id === from ? to : id)},
    };
  });

  const before = planProject(doc);
  const staged = previewTransaction(doc, events, doc.revision);
  const states = new Map(staged.plan.features.map(({feature,status}) =>
    [feature.id,status] as const));
  for (const row of before.features) {
    if (row.status === 'ready' && states.get(row.feature.id) !== 'ready') {
      fail('relocate makes previously ready feature unresolved: ' + row.feature.id);
    }
  }
  const confirmed = writerChain(staged.document, request.targetBodyId)
    .map((f) => f.id);
  if (JSON.stringify(confirmed) !== JSON.stringify(newIds)) {
    fail('relocate did not retain an ordered, dependency-ready body');
  }
  const invalidation = planIncrementalEvaluation(doc, staged.document);
  const invalidated = new Set(invalidation.invalidatedFeatureIds);
  const bodies = new Set<string>();
  for (const feature of featuresOf(staged.document)) {
    if (!invalidated.has(feature.id) ||
        (feature.kind !== 'cut' && feature.kind !== 'extrude')) continue;
    for (const bodyId of feature.writeTargets) bodies.add(bodyId);
  }
  return {
    format:'intuit3d.body-cut-relocate-preview',version:1,
    document:staged.document,events:staged.document.journal.slice(doc.revision),
    plan:staged.plan,invalidation,targetBodyId:request.targetBodyId,
    writerOrderBefore:oldIds,writerOrderAfter:newIds,
    rewiredWriterIds:changes.map(({feature}) => feature.id),
    invalidatedBodyIds:[...bodies],authoredTimelineChanged:false,
    exactGeometryAuthority:false,requiresNativeRebuild:true,
  };
}

/** Commit the whole non-adjacent move as a single durable undo frame. */
export function commitUndoableBodyCutRelocate(
  input: UndoHistory, request: BodyCutRelocateRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const staged = previewBodyCutRelocate(history.document, request);
  return commitUndoableTransaction(history, staged.events, request.expectedRevision);
}
