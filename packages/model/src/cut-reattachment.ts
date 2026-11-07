/**
 * @intuit3d/model/cut-reattachment/v1
 *
 * Recover a cut whose original body-producing extrusion was removed by
 * explicitly attaching it to a DIFFERENT, active extrusion of the SAME
 * semantic body. Does not infer equivalent faces, silently rewrite target
 * bodies, alter geometry or revalidate a native cache.
 *
 * Example: delete plate extrusion A (cut becomes unresolved), author extrusion
 * B from the same sketch into body.plate, then repair the cut's dependency A→B.
 * The existing cut's ID, payload, body selection and downstream features
 * survive in one revision-fenced, undoable journal edit.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError,
  ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, Feature, FeatureStatus, JournalEvent, ProjectDocument,
} from './index.ts';
import {
  commitUndoableTransaction, parseUndoHistory, previewTransaction,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';

export const CUT_REATTACHMENT_FORMAT = 'intuit3d.cut-reattachment' as const;
export const CUT_REATTACHMENT_VERSION = 1 as const;

export interface CutReattachmentRequest {
  readonly format: typeof CUT_REATTACHMENT_FORMAT;
  readonly version: typeof CUT_REATTACHMENT_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly cutFeatureId: string;
  /** A removed extrusion which the cut currently depends upon. */
  readonly removedProducerId: string;
  /** An ACTIVE extrusion producing the same semantic body. */
  readonly replacementProducerId: string;
  /** Must match all three participants' declared output/target body. */
  readonly bodyId: string;
  readonly eventId: string;
  /** Explicit permission to retain an unresolved repair, never to claim it ready. */
  readonly admission: 'require_ready' | 'permit_unresolved';
}

export interface CutReattachmentInspection {
  readonly format: 'intuit3d.cut-reattachment-inspection';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly cutFeatureId: string;
  readonly bodyId: string;
  readonly currentStatus: FeatureStatus;
  readonly removedProducerIds: readonly string[];
  readonly activeReplacementIds: readonly string[];
}

export interface CutReattachmentPreview {
  readonly format: 'intuit3d.cut-reattachment-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly cutFeatureId: string;
  readonly bodyId: string;
  readonly previousStatus: FeatureStatus;
  readonly resultingStatus: FeatureStatus;
  readonly exactGeometryAuthority: false;
  readonly requiresNativeRebuild: true;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
function fail(message: string): never {
  throw new ProjectFormatError('cut reattachment: ' + message);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function id(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid ' + label);
}
function matchesBodyWriter(feature: Feature, bodyId: string): boolean {
  return feature.kind === 'extrude' &&
    feature.writeTargets.length === 1 &&
    feature.writeTargets[0] === bodyId;
}
function cutOf(doc: ProjectDocument, cutId: string): Feature {
  id(cutId, 'cut feature ID');
  const cut = featuresOf(doc).find((feature) => feature.id === cutId);
  if (!cut || cut.kind !== 'cut') fail('requires an active cut feature: ' + cutId);
  return cut;
}
function cutBody(cut: Feature): string {
  // The body cannot be inferred from transient geometry or a reused writer.
  const body = cut.payload.targetBodyId;
  if (typeof body !== 'string' || !ID.test(body) ||
      cut.writeTargets.length !== 1 || cut.writeTargets[0] !== body) {
    fail('cut must explicitly target and write exactly one semantic body');
  }
  return body;
}

/**
 * Obtain the last authored definition of an inactive feature, respecting edits
 * before deletion and any intervening explicit restore/delete cycles. This is
 * NOT a native-shape resurrection: the journal retains semantic provenance only.
 */
function removedFeatureOf(doc: ProjectDocument, featureId: string): Feature | null {
  let feature: Feature | null = null;
  let active = false;
  for (const event of doc.journal) {
    if (event.type === 'feature.create' && event.feature.id === featureId) {
      feature = event.feature;
      active = true;
    } else if (event.type === 'feature.edit' && event.featureId === featureId &&
               feature !== null) {
      feature = Object.assign({}, feature as Feature, event.patch);
    } else if (event.type === 'feature.remove' && event.featureId === featureId) {
      active = false;
    } else if (event.type === 'feature.restore' && event.featureId === featureId) {
      active = true;
    }
  }
  return active ? null : feature;
}

/** Read-only UI choice list, never an automatic body/face correspondence. */
export function inspectCutReattachment(
  source: ProjectDocument, cutFeatureId: string,
): CutReattachmentInspection {
  const doc = parseProject(source);
  const cut = cutOf(doc, cutFeatureId);
  const bodyId = cutBody(cut);
  const plan = planProject(doc);
  const status = plan.features.find((row) => row.feature.id === cutFeatureId)!.status;
  const active = featuresOf(doc);
  const removedProducerIds = cut.dependsOn.filter((dep) => {
    const feature = removedFeatureOf(doc, dep);
    return feature !== null && matchesBodyWriter(feature, bodyId);
  });
  const activeReplacementIds = active
    .filter((feature) => feature.id !== cutFeatureId &&
      !cut.dependsOn.includes(feature.id) && matchesBodyWriter(feature, bodyId))
    .map((feature) => feature.id);
  return {
    format: 'intuit3d.cut-reattachment-inspection', version: 1,
    projectId: doc.projectId, revision: doc.revision, cutFeatureId,
    bodyId, currentStatus: status,
    removedProducerIds, activeReplacementIds,
  };
}

/**
 * Preview a safe, explicit cut-body dependency repair. The old producer MUST
 * be a journal tombstone and both extrusions must declare the same body ID.
 * Only the selected cut's dependency list changes: no matching by B-rep index,
 * viewport proximity or inferred chronology is attempted.
 *
 * Strict admission restores a dependency-ready cut without regressing any
 * previously ready feature; permissive admission retains real unresolved
 * diagnostics in the plan. Neither mode certifies physical shape continuity.
 */
export function previewCutReattachment(
  source: ProjectDocument, request: CutReattachmentRequest,
): CutReattachmentPreview {
  const doc = parseProject(source);
  if (!plain(request) ||
      Object.keys(request).length !== 10 ||
      !['format','version','expectedProjectId','expectedRevision','cutFeatureId',
        'removedProducerId','replacementProducerId','bodyId','eventId','admission']
        .every((key) => Object.hasOwn(request, key)) ||
      request.format !== CUT_REATTACHMENT_FORMAT ||
      request.version !== CUT_REATTACHMENT_VERSION ||
      !['require_ready','permit_unresolved'].includes(String(request.admission))) {
    fail('unsupported request format/fields');
  }
  id(request.cutFeatureId, 'cut feature ID');
  id(request.removedProducerId, 'removed producer ID');
  id(request.replacementProducerId, 'replacement producer ID');
  id(request.bodyId, 'body ID');
  id(request.eventId, 'event ID');
  if (doc.projectId !== request.expectedProjectId ||
      doc.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('cut reattachment: stale project/revision');
  }
  if (request.removedProducerId === request.replacementProducerId ||
      request.cutFeatureId === request.replacementProducerId) {
    fail('replacement must be a distinct, active body producer');
  }
  const cut = cutOf(doc, request.cutFeatureId);
  const body = cutBody(cut);
  if (body !== request.bodyId) fail('cut target body differs from explicit request');
  const removed = removedFeatureOf(doc, request.removedProducerId);
  if (!removed || !matchesBodyWriter(removed, body)) {
    fail('old producer must be a removed extrusion of the same body');
  }
  const oldIndex = cut.dependsOn.indexOf(request.removedProducerId);
  if (oldIndex < 0) fail('cut does not depend on the specified removed producer');
  const replacement = featuresOf(doc).find((feature) =>
    feature.id === request.replacementProducerId);
  if (!replacement || !matchesBodyWriter(replacement, body)) {
    fail('replacement must be an active extrusion of the same body');
  }
  if (cut.dependsOn.includes(replacement.id)) {
    fail('cut already depends on the replacement producer');
  }

  const before = planProject(doc);
  const previousStatus = before.features.find((row) =>
    row.feature.id === cut.id)!.status;
  const dependsOn = cut.dependsOn.map((dep) =>
    dep === request.removedProducerId ? request.replacementProducerId : dep);
  const event: JournalEvent = {
    type: 'feature.edit',
    eventId: request.eventId,
    featureId: cut.id,
    patch: { dependsOn },
  };
  const staged = previewTransaction(doc, [event], doc.revision);
  const after = staged.plan;
  const statuses = new Map(after.features.map((row) => [row.feature.id,row.status]));
  const resultingStatus = statuses.get(cut.id)!;
  if (request.admission === 'require_ready' && resultingStatus !== 'ready') {
    fail('repaired cut is still ' + resultingStatus);
  }
  for (const row of before.features) {
    if (row.status === 'ready' && statuses.get(row.feature.id) !== 'ready') {
      fail('repair regresses previously ready feature: ' + row.feature.id);
    }
  }

  return {
    format: 'intuit3d.cut-reattachment-preview', version: 1,
    event: staged.document.journal[staged.document.journal.length - 1]!,
    document: staged.document, plan: after,
    invalidation: planIncrementalEvaluation(doc, staged.document),
    cutFeatureId: cut.id, bodyId: body, previousStatus, resultingStatus,
    exactGeometryAuthority: false, requiresNativeRebuild: true,
  };
}

/** One authoritative journal event, one atomic user undo frame. */
export function commitUndoableCutReattachment(
  input: UndoHistory, request: CutReattachmentRequest,
): UndoHistory {
  const history = parseUndoHistory(input);
  const preview = previewCutReattachment(history.document, request);
  return commitUndoableTransaction(history, [preview.event], request.expectedRevision);
}
