/** Application-owned semantic topology lineage v1. Derived provider reports are not geometric truth. */
export const TOPOLOGY_REFERENCE_FORMAT = 'intuit3d.semantic-topology-reference' as const;
export const TOPOLOGY_REFERENCE_VERSION = 1 as const;
export type TopologyKind = 'body' | 'face' | 'edge' | 'vertex';
export interface TopologyAnchor {
  readonly featureId: string;
  readonly roleId: string; // Stable application output role, never kernel enumeration.
  readonly kind: TopologyKind;
}
export interface SemanticTopologyReference {
  readonly format: typeof TOPOLOGY_REFERENCE_FORMAT;
  readonly version: typeof TOPOLOGY_REFERENCE_VERSION;
  readonly projectId: string;
  readonly atRevision: number;
  readonly anchor: TopologyAnchor;
}
export interface TopologySnapshot {
  readonly projectId: string;
  readonly atRevision: number;
  readonly observedRoles: readonly TopologyAnchor[];
}
export interface TopologyMapping {
  readonly from: readonly TopologyAnchor[];
  readonly to: readonly TopologyAnchor[];
  readonly confidence: 'observed' | 'uncertain'; // Provider report, NOT independent validation.
}
export interface TopologyStep {
  readonly projectId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly coverage: 'complete' | 'partial';
  readonly mappings: readonly TopologyMapping[];
}
export interface ManualTopologyBinding {
  readonly format: 'intuit3d.semantic-topology-binding';
  readonly version: 1;
  readonly projectId: string;
  readonly atRevision: number;
  readonly source: TopologyAnchor;
  readonly target: TopologyAnchor;
}
export type TopologyStatus = 'resolved' | 'resolved_manual' | 'requires_reconciliation' | 'pending_evidence' | 'deleted';
export type TopologyDiagnosticCode =
  'UNOBSERVED_ANCHOR' | 'MISSING_STEP' | 'PARTIAL_COVERAGE' | 'UNCERTAIN_MAPPING'
  | 'SPLIT' | 'MERGE' | 'DELETED' | 'INVALID_BINDING';
export interface TopologyDiagnostic {
  readonly code: TopologyDiagnosticCode;
  readonly revision: number;
  readonly message: string;
}
export interface TopologyResolution {
  readonly status: TopologyStatus;
  readonly projectId: string;
  readonly atRevision: number;
  readonly targetRevision: number;
  readonly lastObservedRevision: number;
  readonly candidates: readonly TopologyAnchor[];
  readonly diagnostics: readonly TopologyDiagnostic[];
}
export class TopologyEvidenceError extends Error { override name = 'TopologyEvidenceError'; }
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const fail = (where: string, what: string): never => { throw new TopologyEvidenceError(where + ': ' + what); };
function obj(v: unknown, where: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(where, 'expected object');
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) fail(where, 'expected plain object');
  return v as Record<string, unknown>;
}
function fields(o: Record<string, unknown>, keys: string[], where: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(where, 'unsupported field ' + k);
  for (const k of keys) if (!Object.hasOwn(o, k)) fail(where, 'missing field ' + k);
}
function sid(v: unknown, where: string): string {
  if (typeof v !== 'string' || !ID.test(v)) fail(where, 'invalid semantic identifier');
  return v as string;
}
function rev(v: unknown, where: string): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0) fail(where, 'expected nonnegative safe revision');
  return v as number;
}
function arr(v: unknown, where: string, limit = 4096): unknown[] {
  if (!Array.isArray(v) || v.length > limit) fail(where, 'expected bounded array');
  return v as unknown[];
}
function pick<T extends string>(v: unknown, options: readonly T[], where: string): T {
  if (typeof v !== 'string' || !options.includes(v as T)) fail(where, 'unsupported value');
  return v as T;
}
function parseAnchor(v: unknown, where: string): TopologyAnchor {
  const o = obj(v, where);
  fields(o, ['featureId','roleId','kind'], where);
  return { featureId: sid(o.featureId, where + '.featureId'), roleId: sid(o.roleId, where + '.roleId'),
    kind: pick(o.kind, ['body','face','edge','vertex'], where + '.kind') };
}
const key = (a: TopologyAnchor): string => a.kind + '|' + a.featureId + '|' + a.roleId;
function parseAnchors(v: unknown, where: string, required = false): TopologyAnchor[] {
  const values = arr(v, where).map((x,i) => parseAnchor(x, where + '[' + i + ']'));
  if (required && !values.length) fail(where, 'nonempty source set required');
  if (new Set(values.map(key)).size !== values.length) fail(where, 'duplicate role');
  return values;
}
export function parseSemanticTopologyReference(v: unknown): SemanticTopologyReference {
  const o = obj(v, 'reference');
  fields(o, ['format','version','projectId','atRevision','anchor'], 'reference');
  if (o.format !== TOPOLOGY_REFERENCE_FORMAT || o.version !== 1) fail('reference', 'unsupported version');
  return { format: TOPOLOGY_REFERENCE_FORMAT, version: 1,
    projectId: sid(o.projectId, 'reference.projectId'), atRevision: rev(o.atRevision, 'reference.atRevision'),
    anchor: parseAnchor(o.anchor, 'reference.anchor') };
}
function parseSnapshot(v: unknown): TopologySnapshot {
  const o = obj(v, 'snapshot');
  fields(o, ['projectId','atRevision','observedRoles'], 'snapshot');
  return { projectId: sid(o.projectId,'snapshot.projectId'), atRevision: rev(o.atRevision,'snapshot.atRevision'),
    observedRoles: parseAnchors(o.observedRoles,'snapshot.observedRoles') };
}
function parseStep(v: unknown, where: string): TopologyStep {
  const o = obj(v, where);
  fields(o, ['projectId','fromRevision','toRevision','coverage','mappings'], where);
  const fromRevision = rev(o.fromRevision, where+'.fromRevision'), toRevision = rev(o.toRevision, where+'.toRevision');
  if (toRevision !== fromRevision + 1) fail(where, 'each transition must advance one revision');
  const seenSource = new Set<string>(), seenTarget = new Set<string>();
  const mappings = arr(o.mappings,where+'.mappings').map((m,i): TopologyMapping => {
    const path = where+'.mappings['+i+']', row = obj(m,path);
    fields(row, ['from','to','confidence'],path);
    const from = parseAnchors(row.from,path+'.from',true), to = parseAnchors(row.to,path+'.to');
    if ([...from,...to].some(a=>a.kind!==from[0].kind)) fail(path,'topology kind changed');
    for (const a of from) { if (seenSource.has(key(a))) fail(path,'duplicate source ownership'); seenSource.add(key(a)); }
    for (const a of to) { if (seenTarget.has(key(a))) fail(path,'contradictory target ownership'); seenTarget.add(key(a)); }
    return {from,to,confidence:pick(row.confidence,['observed','uncertain'],path+'.confidence')};
  });
  return { projectId:sid(o.projectId,where+'.projectId'), fromRevision,toRevision,
    coverage:pick(o.coverage,['complete','partial'],where+'.coverage'), mappings };
}
function parseBinding(v: unknown): ManualTopologyBinding {
  const o = obj(v,'binding');
  fields(o,['format','version','projectId','atRevision','source','target'],'binding');
  if (o.format !== 'intuit3d.semantic-topology-binding' || o.version !== 1) fail('binding','unsupported version');
  return { format:'intuit3d.semantic-topology-binding', version:1,
    projectId:sid(o.projectId,'binding.projectId'),atRevision:rev(o.atRevision,'binding.atRevision'),
    source:parseAnchor(o.source,'binding.source'),target:parseAnchor(o.target,'binding.target') };
}
/**
 * Every source role must be explicitly traced at every revision. A missing/uncertain
 * report is pending, not identity. Splits, merges and partial loss permanently taint
 * automatic resolution, including paths that subsequently converge.
 */
export function resolveSemanticTopologyReference(
  rawReference: unknown, rawSnapshot: unknown, rawSteps: unknown,
  target: number, rawBinding?: unknown,
): TopologyResolution {
  const ref = parseSemanticTopologyReference(rawReference);
  const snap = parseSnapshot(rawSnapshot);
  const targetRevision = rev(target,'targetRevision');
  if (snap.projectId !== ref.projectId || snap.atRevision !== ref.atRevision) fail('snapshot','reference mismatch');
  if (targetRevision < ref.atRevision) fail('targetRevision','precedes source');
  const steps = arr(rawSteps,'steps',2048).map((x,i)=>parseStep(x,'steps['+i+']'));
  for (const s of steps) {
    if (s.projectId!==ref.projectId) fail('steps','cross-project evidence');
    if (s.fromRevision<ref.atRevision || s.toRevision>targetRevision) fail('steps','transition outside interval');
  }
  const binding = rawBinding === undefined ? undefined : parseBinding(rawBinding);
  const diagnostics: TopologyDiagnostic[] = [];
  const add = (code:TopologyDiagnosticCode,revision:number,message:string):void => {
    diagnostics.push({code,revision,message});
  };
  let candidates: TopologyAnchor[] = [ref.anchor];
  let lastObservedRevision = ref.atRevision;
  const result = (status:TopologyStatus):TopologyResolution => ({
    status,projectId:ref.projectId,atRevision:ref.atRevision,targetRevision,lastObservedRevision,candidates,diagnostics,
  });
  if (!snap.observedRoles.some(a=>key(a)===key(ref.anchor))) {
    add('UNOBSERVED_ANCHOR',ref.atRevision,'Source role was not observed');
    return result('pending_evidence');
  }
  let ambiguous = false, cursor = ref.atRevision;
  for (const s of steps) {
    if (s.fromRevision < cursor) fail('steps','duplicate/out-of-order transition');
    if (s.fromRevision > cursor) {
      add('MISSING_STEP',cursor,'Missing required intermediate transition');
      return result('pending_evidence');
    }
    const next = new Map<string,TopologyAnchor>();
    // One lookup per observed source role, not O(candidates * mapping rows).
    const bySource = new Map<string,TopologyMapping>();
    for (const mapping of s.mappings) for (const source of mapping.from) bySource.set(key(source),mapping);
    for (const role of candidates) {
      const m = bySource.get(key(role));
      if (!m) {
        if (s.coverage==='partial') {
          add('PARTIAL_COVERAGE',cursor,'Missing role under partial coverage');
          return result('pending_evidence');
        }
        ambiguous = true;
        add('DELETED',s.toRevision,'Role omitted by complete report');
        continue;
      }
      if (m.confidence==='uncertain') {
        add('UNCERTAIN_MAPPING',s.toRevision,'Provider relationship uncertain');
        return result('pending_evidence');
      }
      if (m.from.length>1) { ambiguous=true; add('MERGE',s.toRevision,'Multiple provenance sources'); }
      if (m.to.length>1) { ambiguous=true; add('SPLIT',s.toRevision,'Multiple successor roles'); }
      if (!m.to.length) { ambiguous=true; add('DELETED',s.toRevision,'Role deleted'); }
      for (const successor of m.to) next.set(key(successor),successor);
    }
    candidates = [...next.values()].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
    cursor = s.toRevision;
    lastObservedRevision = cursor;
    if (!candidates.length) return result('deleted');
  }
  if (cursor!==targetRevision) {
    add('MISSING_STEP',cursor,'Missing required trailing transition');
    return result('pending_evidence');
  }
  if (binding) {
    if (binding.projectId!==ref.projectId || binding.atRevision!==targetRevision ||
      key(binding.source)!==key(ref.anchor) || !candidates.some(c=>key(c)===key(binding.target))) {
      add('INVALID_BINDING',targetRevision,'Stale binding or unobserved target');
      return result('requires_reconciliation');
    }
    return result('resolved_manual');
  }
  return result(ambiguous || candidates.length!==1 ? 'requires_reconciliation' : 'resolved');
}
