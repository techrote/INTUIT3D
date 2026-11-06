/**
 * Isolated WORKBENCH preview adapter (NOT the authoritative INTENT model).
 * The five scalar parameters form an intentionally small demo contract. Nothing
 * exported from here is an OCCT B-rep, durable semantic topology or STEP data.
 */
export const FORMAT = 'intuit3d.web-preview' as const;
export const VERSION = 1 as const;

export type DimensionKey = 'width' | 'depth' | 'thickness' | 'holeDiameter' | 'holeSpacing';
export const DIMENSIONS: readonly DimensionKey[] = [
  'width', 'depth', 'thickness', 'holeDiameter', 'holeSpacing',
];

export interface Parameters {
  width: number;
  depth: number;
  thickness: number;
  holeDiameter: number;
  holeSpacing: number;
}

export interface Feature {
  readonly id: string;
  readonly label: string;
  readonly kind: 'sketch' | 'extrude' | 'cut' | 'reference';
  readonly dependsOn: readonly string[];
}

/** App-owned demonstration IDs, never OCCT topological references. */
export const FEATURES: readonly Feature[] = [
  { id: 'sketch-plate', label: 'Plate profile', kind: 'sketch', dependsOn: [] },
  { id: 'extrude-plate', label: 'Plate extrusion', kind: 'extrude', dependsOn: ['sketch-plate'] },
  { id: 'sketch-holes', label: 'Hole centres', kind: 'sketch', dependsOn: ['sketch-plate'] },
  { id: 'cut-holes', label: 'Through holes', kind: 'cut', dependsOn: ['extrude-plate', 'sketch-holes'] },
];

export interface Document {
  readonly format: typeof FORMAT;
  readonly version: typeof VERSION;
  readonly id: string;
  readonly name: string;
  readonly units: 'mm';
  readonly params: Parameters;
  /** A separately authored future-target reference demonstrates pending intent. */
  readonly futureReference: boolean;
  readonly referenceResolved: boolean;
  readonly revision: number;
  readonly chronology: readonly string[];
}

export type Command =
  | { readonly kind: 'dimension'; readonly key: DimensionKey; readonly value: number }
  | { readonly kind: 'pending-reference'; readonly enabled: boolean }
  | { readonly kind: 'resolve-reference'; readonly enabled: boolean }
  | { readonly kind: 'rename'; readonly name: string };

export type Diagnostic = { readonly code: 'invalid-dimension' | 'hole-boundary' | 'hole-overlap' | 'pending-reference'; readonly message: string; readonly featureId: string };

/** Transient pointer interaction. This is not part of saved project intent. */
export interface DimensionGesture {
  readonly key: DimensionKey;
  readonly initial: Document;
  readonly initialLastValid: Document | null;
}

export interface Workspace {
  readonly document: Document;
  readonly lastValid: Document | null;
  readonly past: readonly Document[];
  readonly future: readonly Document[];
  readonly gesture: DimensionGesture | null;
}

const DEFAULT_PARAMS: Parameters = {
  width: 120,
  depth: 80,
  thickness: 8,
  holeDiameter: 12,
  holeSpacing: 64,
};

export function newDocument(): Document {
  return {
    format: FORMAT, version: VERSION, id: 'demo-plate-001', name: 'Mounting plate',
    units: 'mm', params: { ...DEFAULT_PARAMS }, futureReference: false,
    referenceResolved: false, revision: 0,
    chronology: ['Sketch: Plate profile', 'Extrude: Plate', 'Sketch: Hole centres', 'Cut: Two through holes'],
  };
}

function hasExactFields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((field) => Object.hasOwn(value, field));
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateDocument(value: unknown): asserts value is Document {
  if (!isObject(value) || !hasExactFields(value, ['format', 'version', 'id', 'name', 'units', 'params', 'futureReference', 'referenceResolved', 'revision', 'chronology'])) {
    throw new Error('Unrecognised project envelope');
  }
  if (value.format !== FORMAT || value.version !== VERSION) throw new Error('Unsupported project format or version');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id)) throw new Error('Invalid project ID');
  if (typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 96) throw new Error('Invalid project name');
  if (value.units !== 'mm') throw new Error('Only millimetre preview projects are supported');
  if (typeof value.futureReference !== 'boolean' || typeof value.referenceResolved !== 'boolean') throw new Error('Invalid reference state');
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new Error('Invalid revision');
  if (!isObject(value.params) || !hasExactFields(value.params, DIMENSIONS)) throw new Error('Invalid parameter set');
  for (const key of DIMENSIONS) {
    if (typeof value.params[key] !== 'number' || !Number.isFinite(value.params[key])) throw new Error(`Invalid finite dimension: ${key}`);
  }
  if (!Array.isArray(value.chronology) || value.chronology.length > 1024 || !value.chronology.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 180)) {
    throw new Error('Invalid authored chronology');
  }
}

/** Persist only validated intent-preview values. Never persist a cached mesh. */
export function serializeDocument(doc: Document): string {
  validateDocument(doc);
  return JSON.stringify(doc, null, 2);
}

export function parseDocument(source: string): Document {
  if (source.length > 1024 * 1024) throw new Error('File exceeds 1 MiB preview project limit');
  const parsed: unknown = JSON.parse(source);
  validateDocument(parsed);
  const doc = parsed as Document;
  return {
    ...doc,
    params: { ...doc.params },
    chronology: [...doc.chronology],
  };
}

/**
 * Analytic sketch-intent validation only. Positive dimensions are necessary but
 * not evidence of a kernel-valid body. A rejected edit must remain editable.
 */
export function diagnostics(doc: Document): Diagnostic[] {
  const p = doc.params;
  const failures: Diagnostic[] = [];
  for (const key of DIMENSIONS) {
    const n = p[key];
    if (!Number.isFinite(n) || n <= 0 || n > 10_000) {
      failures.push({ code: 'invalid-dimension', message: `${key} must be finite and between 0 and 10,000 mm`, featureId: key === 'thickness' ? 'extrude-plate' : 'sketch-plate' });
    }
  }
  if (failures.length === 0) {
    if (p.holeDiameter >= p.depth || p.holeSpacing + p.holeDiameter >= p.width) {
      failures.push({ code: 'hole-boundary', message: 'Hole profiles meet or cross the plate boundary', featureId: 'cut-holes' });
    }
    if (p.holeSpacing <= p.holeDiameter) {
      failures.push({ code: 'hole-overlap', message: 'Hole profiles touch or overlap', featureId: 'cut-holes' });
    }
  }
  if (doc.futureReference && !doc.referenceResolved) {
    failures.push({ code: 'pending-reference', message: 'Future datum reference remains unresolved — preserve intent', featureId: 'future-datum' });
  }
  return failures;
}

/** Pending external reference does not invalidate otherwise sound plate geometry. */
export function geometryIsAdmissible(doc: Document): boolean {
  return diagnostics(doc).every((entry) => entry.code === 'pending-reference');
}

export function newWorkspace(doc: Document = newDocument()): Workspace {
  validateDocument(doc);
  // A separately loaded invalid project is not assigned a pretend last-good mesh.
  return { document: doc, lastValid: geometryIsAdmissible(doc) ? doc : null, past: [], future: [], gesture: null };
}

/** Start a dimension transaction; only the eventual pointer-up creates a journal entry. */
export function beginDimensionGesture(workspace: Workspace, key: DimensionKey): Workspace {
  if (!DIMENSIONS.includes(key)) throw new Error('Unknown gesture dimension');
  const stable = workspace.gesture ? commitDimensionGesture(workspace) : workspace;
  return { ...stable, gesture: { key, initial: stable.document, initialLastValid: stable.lastValid } };
}

/** Live preview is deliberately ephemeral: no revision, history or last-good promotion. */
export function previewDimensionGesture(workspace: Workspace, value: number): Workspace {
  const active = workspace.gesture;
  if (!active) throw new Error('No active dimension gesture');
  if (!Number.isFinite(value)) throw new Error('Gesture value must be finite');
  if (Object.is(workspace.document.params[active.key], value)) return workspace;
  const doc = { ...workspace.document, params: { ...workspace.document.params, [active.key]: value } };
  return { ...workspace, document: doc };
}

/** Pointer cancellation must never leave an unjournalled edit or false saved state. */
export function cancelDimensionGesture(workspace: Workspace): Workspace {
  if (!workspace.gesture) return workspace;
  return { ...workspace, document: workspace.gesture.initial, lastValid: workspace.gesture.initialLastValid, gesture: null };
}

/** Commit the complete drag as exactly one undoable command, including invalid intent. */
export function commitDimensionGesture(workspace: Workspace): Workspace {
  const active = workspace.gesture;
  if (!active) return workspace;
  const value = workspace.document.params[active.key];
  const base = cancelDimensionGesture(workspace);
  if (Object.is(active.initial.params[active.key], value)) return base;
  return apply(base, { kind: 'dimension', key: active.key, value });
}

export function apply(workspace: Workspace, command: Command): Workspace {
  // Other UI commands cannot silently discard an in-progress pointer edit.
  if (workspace.gesture) workspace = commitDimensionGesture(workspace);
  const before = workspace.document;
  let next: Document;
  let summary: string;
  if (command.kind === 'dimension') {
    if (!DIMENSIONS.includes(command.key) || !Number.isFinite(command.value)) throw new Error('Dimension must be finite and recognised');
    if (Object.is(before.params[command.key], command.value)) return workspace;
    next = { ...before, params: { ...before.params, [command.key]: command.value } };
    summary = `Dimension: ${command.key} = ${command.value} mm`;
  } else if (command.kind === 'pending-reference') {
    if (before.futureReference === command.enabled) return workspace;
    next = { ...before, futureReference: command.enabled, referenceResolved: command.enabled ? before.referenceResolved : false };
    summary = command.enabled ? 'Create: Forward datum reference' : 'Remove: Forward datum reference';
  } else if (command.kind === 'resolve-reference') {
    if (!before.futureReference || before.referenceResolved === command.enabled) return workspace;
    next = { ...before, referenceResolved: command.enabled };
    summary = command.enabled ? 'Resolve: Forward datum reference' : 'Unresolve: Forward datum reference';
  } else {
    if (command.name.length < 1 || command.name.length > 96) throw new Error('Project name must contain 1–96 characters');
    if (before.name === command.name) return workspace;
    next = { ...before, name: command.name };
    summary = `Rename: ${command.name}`;
  }
  if (before.chronology.length >= 1024) throw new Error('Preview journal capacity reached (1024 entries); edit was not applied');
  next = { ...next, revision: before.revision + 1, chronology: [...before.chronology, summary] };
  return { document: next, lastValid: geometryIsAdmissible(next) ? next : workspace.lastValid, past: [...workspace.past, before], future: [], gesture: null };
}

export function undo(workspace: Workspace): Workspace {
  if (workspace.gesture) return cancelDimensionGesture(workspace);
  const previous = workspace.past.at(-1);
  if (!previous) return workspace;
  return {
    document: previous,
    // An undo must never display a future revision as an earlier 'last good' body.
    lastValid: geometryIsAdmissible(previous) ? previous :
      [...workspace.past.slice(0, -1)].reverse().find(geometryIsAdmissible) ?? null,
    past: workspace.past.slice(0, -1), future: [workspace.document, ...workspace.future], gesture: null,
  };
}
export function redo(workspace: Workspace): Workspace {
  if (workspace.gesture) return cancelDimensionGesture(workspace);
  const next = workspace.future[0];
  if (!next) return workspace;
  return {
    document: next,
    lastValid: geometryIsAdmissible(next) ? next : workspace.lastValid,
    past: [...workspace.past, workspace.document], future: workspace.future.slice(1), gesture: null,
  };
}

export type FeatureState = { readonly id: string; readonly label: string; readonly status: 'preview-ready' | 'pending' | 'blocked'; readonly dependsOn: readonly string[] };
export function featureStates(doc: Document): FeatureState[] {
  const errs = diagnostics(doc);
  const invalidPlate = errs.some((x) => x.featureId === 'sketch-plate');
  const invalidExtrude = invalidPlate || errs.some((x) => x.featureId === 'extrude-plate');
  const invalidCut = invalidExtrude || errs.some((x) => x.featureId === 'cut-holes');
  const base: FeatureState[] = FEATURES.map((feature) => ({
    ...feature, status: (feature.id === 'sketch-plate' && invalidPlate) || (feature.id === 'extrude-plate' && invalidExtrude) || (feature.id === 'cut-holes' && invalidCut) ? 'blocked' as const : 'preview-ready' as const,
  }));
  if (doc.futureReference) base.push({ id: 'future-datum', label: 'Future datum reference', dependsOn: ['datum-001'], status: doc.referenceResolved ? 'preview-ready' : 'pending' });
  return base;
}

export const PARAMETER_LABELS: Record<DimensionKey, string> = {
  width: 'Plate width', depth: 'Plate depth', thickness: 'Thickness',
  holeDiameter: 'Hole diameter', holeSpacing: 'Hole pitch',
};
