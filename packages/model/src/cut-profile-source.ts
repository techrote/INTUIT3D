/**
 * @intuit3d/model/cut-profile-source/v1
 *
 * An explicit, undoable user edit of a cut's sketch/profile source. A cut may
 * survive replacement of a missing sketch without changing its semantic cut
 * ID, body target, ordered body-writer dependency, extent or downstream IDs.
 *
 * This is authoritative journal intent and structural replay ONLY. A SKETCH
 * provider must admit the new profile and KERNEL must rebuild/validate the
 * solid and STEP independently. A cycle: candidate string is a selector,
 * not evidence that the selected sketch contains that cycle.
 */
import {
  featuresOf, parseProject, planProject, ProjectFormatError, ProjectRevisionError,
} from './index.ts';
import type {
  EvaluationPlan, Feature, FeatureStatus, JournalEvent, ProjectDocument,
} from './index.ts';
import { planIncrementalEvaluation } from './incremental.ts';
import type { IncrementalEvaluationPlan } from './incremental.ts';
import {
  previewTransaction, commitUndoableTransaction, parseUndoHistory,
} from './transactions.ts';
import type { UndoHistory } from './transactions.ts';

export const CUT_PROFILE_SOURCE_FORMAT = 'intuit3d.cut-profile-source' as const;
export const CUT_PROFILE_SOURCE_VERSION = 1 as const;

export interface CutProfileSourceEditRequest {
  readonly format: typeof CUT_PROFILE_SOURCE_FORMAT;
  readonly version: typeof CUT_PROFILE_SOURCE_VERSION;
  readonly expectedProjectId: string;
  readonly expectedRevision: number;
  readonly eventId: string;
  readonly cutFeatureId: string;
  readonly targetBodyId: string;
  /** Optimistic source guards: both must match the *authored* cut. */
  readonly expectedSourceSketchId: string;
  readonly expectedProfileCandidateId: string;
  readonly sourceSketchId: string;
  readonly profileCandidateId: string;
  /**
   * Explicit author choice to release the previous sketch dependency.
   * false retains it (and any pending status); true transfers that edge.
   * It never removes unrelated dependencies or body-writer ordering.
   */
  readonly releasePreviousSketchDependency: boolean;
  /** Planner readiness only; SKETCH profile and B-rep admission are separate. */
  readonly admission: 'require_ready' | 'permit_unresolved';
}

export interface CutProfileSourceInspection {
  readonly format: 'intuit3d.cut-profile-source-inspection';
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly cutFeatureId: string;
  readonly targetBodyId: string;
  readonly sourceSketchId: string;
  readonly profileCandidateId: string;
  readonly semanticStatus: FeatureStatus;
  readonly sourceActive: boolean;
}

export interface CutProfileSourceEditPreview {
  readonly format: 'intuit3d.cut-profile-source-preview';
  readonly version: 1;
  readonly event: JournalEvent;
  readonly document: ProjectDocument;
  readonly plan: EvaluationPlan;
  readonly invalidation: IncrementalEvaluationPlan;
  readonly cutFeatureId: string;
  readonly targetBodyId: string;
  readonly previousSourceSketchId: string;
  readonly nextSourceSketchId: string;
  readonly semanticStatus: FeatureStatus;
  readonly requiresSketchAdmission: true;
  readonly requiresNativeRebuild: true;
  readonly exactGeometryAuthority: false;
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const FIELDS = [
  'format', 'version', 'expectedProjectId', 'expectedRevision', 'eventId',
  'cutFeatureId', 'targetBodyId', 'expectedSourceSketchId',
  'expectedProfileCandidateId', 'sourceSketchId', 'profileCandidateId',
  'releasePreviousSketchDependency', 'admission',
] as const;

function fail(reason: string): never {
  throw new ProjectFormatError('cut profile source: ' + reason);
}
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = Object.getPrototypeOf(value);
  return p === Object.prototype || p === null;
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}
function isCandidate(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('cycle:') &&
    value.length > 6 && value.length <= 8192;
}
function isRequest(value: unknown): value is CutProfileSourceEditRequest {
  if (!plain(value) || Object.keys(value).length !== FIELDS.length ||
      !FIELDS.every((field) => Object.hasOwn(value, field))) return false;
  return value.format === CUT_PROFILE_SOURCE_FORMAT &&
    value.version === CUT_PROFILE_SOURCE_VERSION &&
    isId(value.expectedProjectId) && typeof value.expectedRevision === 'number' &&
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 &&
    isId(value.eventId) && isId(value.cutFeatureId) && isId(value.targetBodyId) &&
    isId(value.expectedSourceSketchId) && isId(value.sourceSketchId) &&
    isCandidate(value.expectedProfileCandidateId) && isCandidate(value.profileCandidateId) &&
    typeof value.releasePreviousSketchDependency === 'boolean' &&
    (value.admission === 'require_ready' || value.admission === 'permit_unresolved');
}
function cutOf(document: ProjectDocument, featureId: string, bodyId: string): Feature {
  if (!isId(featureId) || !isId(bodyId)) fail('invalid cut/body semantic identifier');
  const feature = featuresOf(document).find((item) => item.id === featureId);
  if (!feature || feature.kind !== 'cut' ||
      feature.writeTargets.length !== 1 || feature.writeTargets[0] !== bodyId ||
      feature.payload.targetBodyId !== bodyId) {
    fail('cut must be an active, explicit writer of the selected semantic body');
  }
  if (!isId(feature.payload.sourceSketchId) ||
      !isCandidate(feature.payload.profileCandidateId) ||
      !feature.dependsOn.includes(feature.payload.sourceSketchId)) {
    fail('cut lacks an authored source sketch/profile dependency');
  }
  return feature;
}

/** UI inspector: source and status are authored/structural, not native geometry. */
export function inspectCutProfileSource(
  source: ProjectDocument, cutFeatureId: string, targetBodyId: string,
): CutProfileSourceInspection {
  const document = parseProject(source);
  const cut = cutOf(document, cutFeatureId, targetBodyId);
  const sketch = featuresOf(document).find((item) =>
    item.id === cut.payload.sourceSketchId && item.kind === 'sketch');
  const semanticStatus = planProject(document).features.find((item) =>
    item.feature.id === cutFeatureId)!.status;
  return {
    format: 'intuit3d.cut-profile-source-inspection', version: 1,
    projectId: document.projectId, revision: document.revision,
    cutFeatureId, targetBodyId,
    sourceSketchId: cut.payload.sourceSketchId as string,
    profileCandidateId: cut.payload.profileCandidateId as string,
    semanticStatus, sourceActive: Boolean(sketch),
  };
}

/**
 * Preview an actual cut-profile edit. The caller must select a sketch and
 * candidate; MODEL does not silently choose either from displayed geometry.
 * The old sketch edge can only be removed with the explicit transfer flag.
 * The operation replays all downstream authored dependencies without rewriting
 * other body writers or silently declaring a B-rep/STEP valid.
 */
export function previewCutProfileSourceEdit(
  source: ProjectDocument, request: CutProfileSourceEditRequest,
): CutProfileSourceEditPreview {
  const document = parseProject(source);
  if (!isRequest(request)) fail('unsupported request format, fields or IDs');
  if (document.projectId !== request.expectedProjectId ||
      document.revision !== request.expectedRevision) {
    throw new ProjectRevisionError('cut profile source: stale project/revision');
  }
  const cut = cutOf(document, request.cutFeatureId, request.targetBodyId);
  if (cut.payload.sourceSketchId !== request.expectedSourceSketchId ||
      cut.payload.profileCandidateId !== request.expectedProfileCandidateId) {
    throw new ProjectRevisionError('cut profile source: authored source changed');
  }
  if (request.sourceSketchId === request.expectedSourceSketchId &&
      request.profileCandidateId === request.expectedProfileCandidateId) {
    fail('source edit must change sketch or profile');
  }
  const active = featuresOf(document);
  const chosen = active.find((item) => item.id === request.sourceSketchId);
  if (chosen && chosen.kind !== 'sketch') {
    fail('selected source is not a sketch feature');
  }
  if (!chosen && request.admission === 'require_ready') {
    fail('selected sketch is missing; use explicit pending admission');
  }

  const oldId = request.expectedSourceSketchId;
  const dependencies = cut.dependsOn.filter((id) =>
    !(request.releasePreviousSketchDependency && id === oldId));
  if (!dependencies.includes(request.sourceSketchId)) {
    dependencies.push(request.sourceSketchId);
  }
  const event: JournalEvent = {
    type: 'feature.edit', eventId: request.eventId, featureId: cut.id,
    patch: {
      dependsOn: dependencies,
      payload: {
        ...cut.payload, sourceSketchId: request.sourceSketchId,
        profileCandidateId: request.profileCandidateId,
      },
    },
  };
  const before = planProject(document);
  const staged = previewTransaction(document, [event], document.revision);
  const statuses = new Map(staged.plan.features.map((row) =>
    [row.feature.id, row.status] as const));
  const semanticStatus = statuses.get(cut.id)!;
  if (request.admission === 'require_ready' && semanticStatus !== 'ready') {
    fail('edited cut remains ' + semanticStatus);
  }
  // Never make previously admissible independent or downstream work silently
  // conflicted. Permissive mode permits the edited cut and its descendants to
  // remain unresolved, but not previously ready unrelated features.
  const invalidation = planIncrementalEvaluation(document, staged.document);
  const affected = new Set(invalidation.invalidatedFeatureIds);
  for (const row of before.features) {
    if (row.status === 'ready' && statuses.get(row.feature.id) !== 'ready' &&
        !(request.admission === 'permit_unresolved' && affected.has(row.feature.id))) {
      fail('source edit regresses independent ready feature ' + row.feature.id);
    }
  }
  return {
    format: 'intuit3d.cut-profile-source-preview', version: 1,
    event: staged.document.journal[staged.document.journal.length - 1]!,
    document: staged.document, plan: staged.plan, invalidation,
    cutFeatureId: cut.id, targetBodyId: request.targetBodyId,
    previousSourceSketchId: oldId, nextSourceSketchId: request.sourceSketchId,
    semanticStatus, requiresSketchAdmission: true,
    requiresNativeRebuild: true, exactGeometryAuthority: false,
  };
}

/** One semantic feature edit in one durable, revision-fenced undo frame. */
export function commitUndoableCutProfileSourceEdit(
  source: UndoHistory, request: CutProfileSourceEditRequest,
): UndoHistory {
  const history = parseUndoHistory(source);
  const preview = previewCutProfileSourceEdit(history.document, request);
  return commitUndoableTransaction(history, [preview.event], request.expectedRevision);
}
