/**
 * INTUIT3D model-v1: semantic CAD intent and deterministic evaluation planning.
 *
 * This module does not contain solver, topology, B-rep, preview or import/export
 * geometry. Its project journal is authoritative; evaluation plans are derived.
 */

export const PROJECT_FORMAT = 'intuit3d.project' as const;
export const SCHEMA_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };
export type SemanticId = string;

export interface Feature {
  readonly id: SemanticId;
  /** Application-level operation type, e.g. sketch, extrude, cut or parameter. */
  readonly kind: string;
  /** Explicit semantic dependencies. May refer to features not yet authored. */
  readonly dependsOn: readonly SemanticId[];
  /** Semantic target resource(s) modified by this feature, e.g. body:plate. */
  readonly writeTargets: readonly SemanticId[];
  /** Intent only: dimension values, named roles, expressions and user parameters. */
  readonly payload: Readonly<JsonRecord>;
}

export interface FeaturePatch {
  readonly kind?: string;
  readonly dependsOn?: readonly SemanticId[];
  readonly writeTargets?: readonly SemanticId[];
  readonly payload?: Readonly<JsonRecord>;
}

export type JournalEvent =
  | { readonly eventId: SemanticId; readonly type: 'feature.create'; readonly feature: Feature }
  | { readonly eventId: SemanticId; readonly type: 'feature.edit'; readonly featureId: SemanticId; readonly patch: FeaturePatch }
  | { readonly eventId: SemanticId; readonly type: 'feature.remove'; readonly featureId: SemanticId }
  | { readonly eventId: SemanticId; readonly type: 'feature.restore'; readonly featureId: SemanticId };

export interface ProjectDocument {
  readonly format: typeof PROJECT_FORMAT;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly projectId: SemanticId;
  /** Strictly the count of accepted events in journal. */
  readonly revision: number;
  /** Authoritative, append-only sequence of semantic edit commands. */
  readonly journal: readonly JournalEvent[];
}

export type DiagnosticCode =
  | 'MISSING_REFERENCE'
  | 'SELF_DEPENDENCY'
  | 'DEPENDENCY_CYCLE'
  | 'UNORDERED_MUTATION'
  | 'BLOCKED_DEPENDENCY';

export interface FeatureDiagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly relatedIds: readonly SemanticId[];
}

export type FeatureStatus = 'ready' | 'pending' | 'conflicted' | 'blocked';

export interface FeatureState {
  readonly feature: Feature;
  readonly status: FeatureStatus;
  readonly diagnostics: readonly FeatureDiagnostic[];
}

export interface EvaluationPlan {
  readonly projectId: SemanticId;
  readonly revision: number;
  /** Original feature creation order, independent of dependency ordering. */
  readonly authoredOrder: readonly SemanticId[];
  /** Executable features only, in stable topological order. */
  readonly executableOrder: readonly SemanticId[];
  /** Every living feature (including pending/conflicted/blocked). */
  readonly features: readonly FeatureState[];
}

export class ProjectFormatError extends Error {
  override name = 'ProjectFormatError';
}

export class ProjectRevisionError extends Error {
  override name = 'ProjectRevisionError';
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

function fail(message: string): never {
  throw new ProjectFormatError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) fail(where + ' must be a plain JSON object');
  return value;
}

function strictKeys(obj: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const k of Object.keys(obj)) {
    if (!keys.includes(k)) fail(where + ' has unsupported key ' + JSON.stringify(k));
  }
}

function semanticId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail(where + ' must be an ASCII semantic ID (1-128 characters, letter-prefixed)');
  }
  return value;
}

function idArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) fail(where + ' must be an array');
  const result = value.map((id: unknown, i: number) => semanticId(id, where + '[' + i + ']'));
  if (new Set(result).size !== result.length) fail(where + ' contains duplicate IDs');
  return result;
}

function jsonClone(value: unknown, where: string): JsonValue {
  const seen = new Set<object>();
  const clone = (v: unknown, path: string): JsonValue => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail(path + ' must be finite');
      return v;
    }
    if (typeof v !== 'object') fail(path + ' is not JSON data');
    if (seen.has(v)) fail(path + ' contains a circular reference');
    seen.add(v);
    if (Array.isArray(v)) {
      const out = v.map((item, i) => clone(item, path + '[' + i + ']'));
      seen.delete(v);
      return out;
    }
    const obj = record(v, path);
    const out: JsonRecord = Object.create(null) as JsonRecord;
    for (const key of Object.keys(obj)) {
      // Avoid prototype-related surprises in other JSON consumers.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        fail(path + ' contains reserved key ' + key);
      }
      out[key] = clone(obj[key], path + '.' + key);
    }
    seen.delete(v);
    return out;
  };
  return clone(value, where);
}

function jsonRecord(value: unknown, where: string): JsonRecord {
  record(value, where);
  return jsonClone(value, where) as JsonRecord;
}

function parseFeature(value: unknown, where: string): Feature {
  const f = record(value, where);
  strictKeys(f, ['id', 'kind', 'dependsOn', 'writeTargets', 'payload'], where);
  const id = semanticId(f.id, where + '.id');
  if (typeof f.kind !== 'string' || !ID_PATTERN.test(f.kind)) {
    fail(where + '.kind must be a stable operation identifier');
  }
  return {
    id,
    kind: f.kind,
    dependsOn: idArray(f.dependsOn, where + '.dependsOn'),
    writeTargets: idArray(f.writeTargets, where + '.writeTargets'),
    payload: jsonRecord(f.payload, where + '.payload'),
  };
}

function parsePatch(value: unknown, where: string): FeaturePatch {
  const p = record(value, where);
  strictKeys(p, ['kind', 'dependsOn', 'writeTargets', 'payload'], where);
  if (Object.keys(p).length === 0) fail(where + ' must change at least one field');
  if ('kind' in p && (typeof p.kind !== 'string' || !ID_PATTERN.test(p.kind))) {
    fail(where + '.kind must be a stable operation identifier');
  }
  return {
    ...('kind' in p ? { kind: p.kind as string } : {}),
    ...('dependsOn' in p ? { dependsOn: idArray(p.dependsOn, where + '.dependsOn') } : {}),
    ...('writeTargets' in p ? { writeTargets: idArray(p.writeTargets, where + '.writeTargets') } : {}),
    ...('payload' in p ? { payload: jsonRecord(p.payload, where + '.payload') } : {}),
  };
}

function parseEvent(value: unknown, where: string): JournalEvent {
  const e = record(value, where);
  const eventId = semanticId(e.eventId, where + '.eventId');
  switch (e.type) {
    case 'feature.create':
      strictKeys(e, ['eventId', 'type', 'feature'], where);
      return { eventId, type: e.type, feature: parseFeature(e.feature, where + '.feature') };
    case 'feature.edit':
      strictKeys(e, ['eventId', 'type', 'featureId', 'patch'], where);
      return { eventId, type: e.type, featureId: semanticId(e.featureId, where + '.featureId'), patch: parsePatch(e.patch, where + '.patch') };
    case 'feature.remove':
    case 'feature.restore':
      strictKeys(e, ['eventId', 'type', 'featureId'], where);
      return { eventId, type: e.type, featureId: semanticId(e.featureId, where + '.featureId') };
    default:
      return fail(where + '.type is unsupported');
  }
}

type FeatureSlot = { feature: Feature; ordinal: number; active: boolean };

function materialize(events: readonly JournalEvent[]): Feature[] {
  const slots = new Map<SemanticId, FeatureSlot>();
  const eventIds = new Set<string>();
  for (const [i, event] of events.entries()) {
    if (eventIds.has(event.eventId)) fail('journal[' + i + '] repeats eventId ' + event.eventId);
    eventIds.add(event.eventId);
    if (event.type === 'feature.create') {
      if (slots.has(event.feature.id)) fail('journal[' + i + '] reuses semantic feature ID ' + event.feature.id);
      slots.set(event.feature.id, { feature: event.feature, ordinal: i, active: true });
      continue;
    }
    const slot = slots.get(event.featureId);
    if (!slot) fail('journal[' + i + '] refers to never-created feature ' + event.featureId);
    if (event.type === 'feature.edit') {
      if (!slot.active) fail('journal[' + i + '] cannot edit removed feature ' + event.featureId);
      slot.feature = { ...slot.feature, ...event.patch };
    } else if (event.type === 'feature.remove') {
      if (!slot.active) fail('journal[' + i + '] cannot remove already-removed feature ' + event.featureId);
      slot.active = false;
    } else {
      if (slot.active) fail('journal[' + i + '] cannot restore active feature ' + event.featureId);
      slot.active = true;
    }
  }
  return [...slots.values()]
    .filter((s) => s.active)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((s) => s.feature);
}

/** Build an empty v1 authoritative document. */
export function newProject(projectId: SemanticId): ProjectDocument {
  return { format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, projectId: semanticId(projectId, 'projectId'), revision: 0, journal: [] };
}

/** Parse and verify full semantics; unsupported versions are refused, not downgraded. */
export function parseProject(value: unknown): ProjectDocument {
  const doc = record(value, 'project');
  strictKeys(doc, ['format', 'schemaVersion', 'projectId', 'revision', 'journal'], 'project');
  if (doc.format !== PROJECT_FORMAT || doc.schemaVersion !== SCHEMA_VERSION) {
    fail('unsupported project format/schema (expected ' + PROJECT_FORMAT + ' v' + SCHEMA_VERSION + ')');
  }
  const projectId = semanticId(doc.projectId, 'project.projectId');
  if (!Array.isArray(doc.journal)) fail('project.journal must be an array');
  if (!Number.isSafeInteger(doc.revision) || doc.revision !== doc.journal.length) {
    fail('project.revision must equal journal length');
  }
  const events = doc.journal.map((e: unknown, i: number) => parseEvent(e, 'journal[' + i + ']'));
  materialize(events); // validate command preconditions and non-reused IDs
  return { format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, projectId, revision: events.length, journal: events };
}

/** Serialize authoritative intent only; solver/B-rep/preview state cannot enter. */
export function serializeProject(doc: ProjectDocument): string {
  return JSON.stringify(parseProject(doc));
}

export function deserializeProject(json: string): ProjectDocument {
  let source: unknown;
  try { source = JSON.parse(json); } catch { fail('invalid JSON document'); }
  return parseProject(source);
}

/** Append a validated event atomically with an optimistic revision check. */
export function commitEvent(doc: ProjectDocument, event: JournalEvent, expectedRevision: number = doc.revision): ProjectDocument {
  if (doc.revision !== expectedRevision) {
    throw new ProjectRevisionError('stale revision: expected ' + expectedRevision + ', actual ' + doc.revision);
  }
  const validated = parseProject(doc);
  return parseProject({ ...validated, revision: validated.revision + 1, journal: [...validated.journal, event] });
}

/** Replay all accepted commands, returning intent without derived geometry. */
export function featuresOf(doc: ProjectDocument): readonly Feature[] {
  return materialize(parseProject(doc).journal);
}

function diagnostic(code: DiagnosticCode, message: string, relatedIds: string[]): FeatureDiagnostic {
  return { code, message, relatedIds };
}

/**
 * Derive a dependency-safe executable plan from recorded intent.
 * Any unresolved references, cycles or unordered writes remain visible.
 * Never infer an order for two operations mutating the same semantic target.
 */
export function planProject(input: ProjectDocument): EvaluationPlan {
  const doc = parseProject(input);
  const features = materialize(doc.journal);
  const byId = new Map(features.map((f) => [f.id, f] as const));
  const diag = new Map(features.map((f) => [f.id, [] as FeatureDiagnostic[]] as const));
  const add = (id: string, d: FeatureDiagnostic) => { diag.get(id)!.push(d); };

  for (const f of features) {
    for (const dep of f.dependsOn) {
      if (dep === f.id) add(f.id, diagnostic('SELF_DEPENDENCY', f.id + ' depends on itself', [dep]));
      else if (!byId.has(dep)) add(f.id, diagnostic('MISSING_REFERENCE', 'missing semantic feature ' + dep, [dep]));
    }
  }

  // Iterative Kosaraju SCCs. Deep, valid feature histories must not overflow
  // the JS call stack or be misreported as cycles. Do not infer journal order.
  const reversed = new Map(features.map((f) => [f.id, [] as string[]] as const));
  for (const f of features) {
    for (const dep of f.dependsOn) {
      if (dep !== f.id && byId.has(dep)) reversed.get(dep)!.push(f.id);
    }
  }
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const f of features) {
    if (visited.has(f.id)) continue;
    visited.add(f.id);
    const frames: { id: string; next: number }[] = [{ id: f.id, next: 0 }];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const deps = byId.get(frame.id)!.dependsOn;
      if (frame.next >= deps.length) {
        finishOrder.push(frame.id);
        frames.pop();
        continue;
      }
      const dep = deps[frame.next++];
      if (dep === frame.id || !byId.has(dep) || visited.has(dep)) continue;
      visited.add(dep);
      frames.push({ id: dep, next: 0 });
    }
  }
  const assigned = new Set<string>();
  for (let i = finishOrder.length - 1; i >= 0; i--) {
    const root = finishOrder[i];
    if (assigned.has(root)) continue;
    assigned.add(root);
    const component: string[] = [];
    const pending = [root];
    while (pending.length) {
      const id = pending.pop()!;
      component.push(id);
      for (const follower of reversed.get(id)!) {
        if (assigned.has(follower)) continue;
        assigned.add(follower);
        pending.push(follower);
      }
    }
    if (component.length > 1) {
      const members = new Set(component);
      const ordered = features.filter((f) => members.has(f.id)).map((f) => f.id);
      for (const target of ordered) {
        add(target, diagnostic('DEPENDENCY_CYCLE', 'dependency cycle: ' + ordered.join(' -> '), ordered));
      }
    }
  }

  // A structural happens-before edge can be transitive. Bound traversal to
  // actual reachable IDs without recursive DFS, even for very deep histories.
  const reachability = new Map<string, Set<string>>();
  const ancestors = (id: string): Set<string> => {
    const cached = reachability.get(id);
    if (cached) return cached;
    const visited = new Set<string>();
    const pending = [id];
    while (pending.length) {
      const node = pending.pop()!;
      for (const dep of byId.get(node)?.dependsOn ?? []) {
        if (!byId.has(dep) || visited.has(dep)) continue;
        visited.add(dep);
        pending.push(dep);
      }
    }
    reachability.set(id, visited);
    return visited;
  };
  const writers = new Map<string, string[]>();
  for (const f of features) {
    for (const target of f.writeTargets) {
      if (!writers.has(target)) writers.set(target, []);
      writers.get(target)!.push(f.id);
    }
  }
  for (const [target, ids] of writers) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        if (ancestors(a).has(b) || ancestors(b).has(a)) continue;
        add(a, diagnostic('UNORDERED_MUTATION', 'unordered mutations of ' + target + ' by ' + a + ' and ' + b, [b, target]));
        add(b, diagnostic('UNORDERED_MUTATION', 'unordered mutations of ' + target + ' by ' + a + ' and ' + b, [a, target]));
      }
    }
  }

  // Propagate non-ready states over reverse dependencies without recursion.
  // Local conflicts win over missing references; descendants remain blocked,
  // while independent subgraphs stay executable. Diagnostics retain each
  // directly blocked dependency in its authored dependency order.
  const status = new Map<string, FeatureStatus>();
  const propagationQueue: string[] = [];
  for (const f of features) {
    const current = diag.get(f.id)!;
    const conflicted = current.some((d) =>
      d.code === 'SELF_DEPENDENCY' ||
      d.code === 'DEPENDENCY_CYCLE' ||
      d.code === 'UNORDERED_MUTATION');
    if (conflicted) status.set(f.id, 'conflicted');
    else if (current.some((d) => d.code === 'MISSING_REFERENCE')) status.set(f.id, 'pending');
    if (status.has(f.id)) propagationQueue.push(f.id);
  }
  for (let i = 0; i < propagationQueue.length; i++) {
    for (const child of reversed.get(propagationQueue[i]) ?? []) {
      if (status.has(child)) continue;
      status.set(child, 'blocked');
      propagationQueue.push(child);
    }
  }
  for (const f of features) {
    if (!status.has(f.id)) status.set(f.id, 'ready');
  }
  for (const f of features) {
    if (status.get(f.id) !== 'blocked') continue;
    for (const dep of f.dependsOn) {
      if (status.get(dep) !== 'ready') {
        add(f.id, diagnostic('BLOCKED_DEPENDENCY', 'dependency ' + dep + ' is not ready', [dep]));
      }
    }
  }

  // Stable Kahn sort of only ready nodes. The arbitrary tie breaker affects
  // execution scheduling, not authoritative user-authored feature semantics.
  const ready = features.filter((f) => status.get(f.id) === 'ready');
  const ordinal = new Map(features.map((f, i) => [f.id, i] as const));
  const indegree = new Map<string, number>(ready.map((f) => [f.id, 0] as const));
  const followers = new Map(ready.map((f) => [f.id, [] as string[]] as const));
  for (const f of ready) {
    for (const dep of f.dependsOn) {
      if (!indegree.has(dep)) continue;
      indegree.set(f.id, indegree.get(f.id)! + 1);
      followers.get(dep)!.push(f.id);
    }
  }
  const queue = ready.filter((f) => indegree.get(f.id) === 0).map((f) => f.id);
  const sorted: string[] = [];
  while (queue.length) {
    queue.sort((a, b) => ordinal.get(a)! - ordinal.get(b)!);
    const id = queue.shift()!;
    sorted.push(id);
    for (const next of followers.get(id)!) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (sorted.length !== ready.length) {
    // Defensive invariant: Tarjan must have classified every cycle before sort.
    throw new Error('internal error: ready dependency subgraph is cyclic');
  }

  return {
    projectId: doc.projectId,
    revision: doc.revision,
    authoredOrder: features.map((f) => f.id),
    executableOrder: sorted,
    features: features.map((feature) => ({ feature, status: status.get(feature.id)!, diagnostics: diag.get(feature.id)! })),
  };
}
