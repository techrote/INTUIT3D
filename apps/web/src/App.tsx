import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  apply, beginDimensionGesture, cancelDimensionGesture, commitDimensionGesture,
  diagnostics, featureStates, geometryIsAdmissible, newDocument,
  newWorkspace, PARAMETER_LABELS, parseDocument, previewDimensionGesture, redo, serializeDocument, undo,
  type Command, type DimensionKey, type Workspace,
} from './model';
import { discardRecovery, inspectRecovery, persistRecovery, RECOVERY_CURRENT_KEY, RECOVERY_PREVIOUS_KEY } from './recovery';
import {
  RecoveryWriteConflict, captureRecoverySnapshot, guardedRecoveryMutation, sameRecoverySnapshot,
  type RecoverySnapshot,
} from './recoveryFence';
import { SketchViewport } from './components/SketchViewport';
import { SolidViewport } from './components/SolidViewport';
import './styles.css';

type ViewMode = 'solid' | 'sketch';
type BottomTab = 'chronology' | 'dependencies';
const RECOVERY_KEYS = { current: RECOVERY_CURRENT_KEY, previous: RECOVERY_PREVIOUS_KEY } as const;
const CONCURRENT_DRAFT_WARNING = 'Another workbench tab changed local recovery data. This tab\'s edits are still in memory but cannot overwrite the other draft. Export preview JSON before closing or reload to inspect the latest draft.';

function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    cube: <><path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" /><path d="m3 7 9 5 9-5M12 12v10" /></>,
    sketch: <><path d="M4 19 19 4M4 5h10M5 5v10" /><circle cx="18" cy="18" r="3" /></>,
    save: <><path d="M4 3h14l3 3v15H3V3zM7 3v7h10V3M7 21v-8h10v8" /></>,
    open: <><path d="M3 19V5h7l2 3h9v11H3zM7 13h10m-4-4 4 4-4 4" /></>,
    undo: <><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" /></>,
    redo: <><path d="m15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5" /></>,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3v.1" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    plus: <path d="M12 4v16M4 12h16" />,
    keyboard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>{paths[name] || paths.cube}</svg>;
}

function ParameterEditor({ name, value, onCommit }: { name: DimensionKey; value: number; onCommit: (key: DimensionKey, value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next)) onCommit(name, next);
    else setDraft(String(value));
  };
  return (
    <label className="parameter-row">
      <span>{PARAMETER_LABELS[name]}</span>
      <span className="parameter-input-wrap">
        <input type="number" value={draft} step="any" aria-label={PARAMETER_LABELS[name]}
          onChange={(event) => setDraft(event.target.value)} onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur(); } }} />
        <span>mm</span>
      </span>
    </label>
  );
}

interface Action {
  id: string;
  name: string;
  hint: string;
  execute: () => void;
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => newWorkspace());
  const [view, setView] = useState<ViewMode>('solid');
  const [bottomTab, setBottomTab] = useState<BottomTab>('chronology');
  const [selected, setSelected] = useState('extrude-plate');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [notification, setNotification] = useState<string | null>(null);
  // A previous browser draft must be explicitly accepted or discarded before
  // any new autosave. Otherwise mounting the demo could overwrite recovery.
  const [initialRecovery] = useState(() => {
    const inspection = inspectRecovery(() => window.localStorage, parseDocument);
    let snapshot: RecoverySnapshot | null = null;
    try { snapshot = captureRecoverySnapshot(window.localStorage, RECOVERY_KEYS); }
    catch { /* Browser storage may be disabled; refuse autosave without a baseline. */ }
    return { inspection, snapshot };
  });
  const [recovery, setRecovery] = useState(initialRecovery.inspection);
  const recoverySnapshot = useRef<RecoverySnapshot | null>(initialRecovery.snapshot);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasCommittedEdits = useRef(false);
  useEffect(() => {
    // A pristine demo must not create a nuisance recovery offer on every reload.
    // Once edited, even undo-to-revision-zero is saved so stale drafts stay stale.
    if (recovery.kind !== 'none' || workspace.gesture) return;
    if (workspace.document.revision > 0 || workspace.past.length > 0 || workspace.future.length > 0) {
      hasCommittedEdits.current = true;
    }
    if (!hasCommittedEdits.current) return;
    try {
      const saved = guardedRecoveryMutation(window.localStorage, RECOVERY_KEYS, recoverySnapshot.current,
        () => persistRecovery(() => window.localStorage, serializeDocument(workspace.document), parseDocument));
      recoverySnapshot.current = saved.snapshot;
      setStorageWarning(null);
    } catch (error) {
      setStorageWarning(error instanceof RecoveryWriteConflict ? CONCURRENT_DRAFT_WARNING :
        'Local recovery failed to save this edit. Export preview JSON before closing.');
    }
  }, [recovery.kind, workspace.document, workspace.gesture]);
  const acceptRecovery = () => {
    if (recovery.kind !== 'available') return;
    try {
      // The offer may have become stale while the dialog was open in another tab.
      guardedRecoveryMutation(window.localStorage, RECOVERY_KEYS, recoverySnapshot.current, () => undefined);
    } catch {
      setStorageWarning(CONCURRENT_DRAFT_WARNING);
      return;
    }
    setWorkspace(newWorkspace(recovery.document)); // never fabricate a last-good mesh or undo stack
    hasCommittedEdits.current = true; // even revision-zero backup recovery repairs a corrupt current slot
    setSelected('extrude-plate');
    setRecovery({ kind: 'none' });
    setNotification('Local preview draft recovered. Historical undo and exact geometry were not restored.');
  };
  const rejectRecovery = () => {
    try {
      const saved = guardedRecoveryMutation(window.localStorage, RECOVERY_KEYS, recoverySnapshot.current,
        () => discardRecovery(() => window.localStorage));
      recoverySnapshot.current = saved.snapshot;
      setRecovery({ kind: 'none' });
      setNotification('Stored draft discarded. Starting from the current demonstration project.');
    } catch (error) {
      setStorageWarning(error instanceof RecoveryWriteConflict ? CONCURRENT_DRAFT_WARNING :
        'Unable to discard stored recovery data. Check both recovery slots before continuing.');
    }
  };
  useEffect(() => {
    const onOtherTabStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== RECOVERY_CURRENT_KEY && event.key !== RECOVERY_PREVIOUS_KEY) return;
      try {
        if (event.storageArea === window.localStorage && recoverySnapshot.current &&
          !sameRecoverySnapshot(captureRecoverySnapshot(window.localStorage, RECOVERY_KEYS), recoverySnapshot.current)) {
          setStorageWarning(CONCURRENT_DRAFT_WARNING);
        }
      } catch { setStorageWarning('Browser recovery storage is unavailable; export preview JSON before closing.'); }
    };
    window.addEventListener('storage', onOtherTabStorage);
    return () => window.removeEventListener('storage', onOtherTabStorage);
  }, []);
  const param = workspace.document.params;
  const problems = useMemo(() => diagnostics(workspace.document), [workspace.document]);
  const valid = geometryIsAdmissible(workspace.document);
  const rendered = valid ? workspace.document : workspace.lastValid;
  const stale = !valid && rendered !== null;
  const features = useMemo(() => featureStates(workspace.document), [workspace.document]);

  // Validate edits synchronously in the event handler. A functional updater may
  // run later during render, where a thrown journal-capacity error escapes try/catch.
  const dispatch = useCallback((command: Command) => {
    try { setWorkspace(apply(workspace, command)); setNotification(null); }
    catch (error) { setNotification(error instanceof Error ? error.message : 'Edit failed'); }
  }, [workspace]);
  const update = useCallback((key: DimensionKey, value: number) => dispatch({ kind: 'dimension', key, value }), [dispatch]);
  const beginSketchGesture = useCallback((key: DimensionKey) => setWorkspace((current) => beginDimensionGesture(current, key)), []);
  const previewSketchGesture = useCallback((value: number) => setWorkspace((current) => previewDimensionGesture(current, value)), []);
  const finishSketchGesture = useCallback(() => setWorkspace((current) => commitDimensionGesture(current)), []);
  const cancelSketchGesture = useCallback(() => setWorkspace((current) => cancelDimensionGesture(current)), []);
  const stepUndo = useCallback(() => setWorkspace((current) => undo(current)), []);
  const stepRedo = useCallback(() => setWorkspace((current) => redo(current)), []);
  const save = useCallback(() => {
    const settled = commitDimensionGesture(workspace);
    if (settled !== workspace) setWorkspace(settled);
    const data = serializeDocument(settled.document);
    const href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = `${settled.document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'intuit3d'}.i3d-preview.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    setNotification('Preview project exported locally. Not an engineering CAD or STEP file.');
  }, [workspace]);
  const load = useCallback(async (file: File) => {
    try {
      if (file.size > 1024 * 1024) throw new Error('Project exceeds 1 MiB limit');
      const data = parseDocument(await file.text());
      setWorkspace(newWorkspace(data));
      setSelected('extrude-plate');
      setNotification(`Opened ${data.name}. History before this save is not an undo stack.`);
    } catch (error) {
      setNotification(error instanceof Error ? `Open failed: ${error.message}` : 'Open failed');
    }
  }, []);
  const actions: Action[] = [
    { id: 'solid', name: '3D Solid preview', hint: 'View', execute: () => setView('solid') },
    { id: 'sketch', name: 'Edit 2D sketch', hint: 'View', execute: () => setView('sketch') },
    { id: 'undo', name: 'Undo last command', hint: 'Ctrl+Z', execute: stepUndo },
    { id: 'redo', name: 'Redo last command', hint: 'Ctrl+Shift+Z', execute: stepRedo },
    { id: 'save', name: 'Export preview project', hint: 'Ctrl+S', execute: save },
    { id: 'open', name: 'Open preview project', hint: 'Ctrl+O', execute: () => fileRef.current?.click() },
    { id: 'new', name: 'New mounting plate example', hint: 'Project', execute: () => { setWorkspace(newWorkspace(newDocument())); setSelected('extrude-plate'); } },
    { id: 'reference', name: 'Add unresolved forward datum', hint: 'Intent', execute: () => dispatch({ kind: 'pending-reference', enabled: true }) },
  ];
  const matching = actions.filter((item) => item.name.toLowerCase().includes(paletteQuery.toLowerCase()));
  const command = (fn: () => void) => { fn(); setPaletteOpen(false); setPaletteQuery(''); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Recovery decision is modal: shortcuts must not mutate the hidden demo.
      if (recovery.kind === 'available' || recovery.kind === 'corrupt') return;
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, [contenteditable="true"]');
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (ctrl && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
      if (ctrl && event.key.toLowerCase() === 'o') { event.preventDefault(); fileRef.current?.click(); return; }
      if (typing) { if (event.key === 'Escape') setPaletteOpen(false); return; }
      if (ctrl && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) stepRedo(); else stepUndo(); }
      if (ctrl && event.key.toLowerCase() === 'y') { event.preventDefault(); stepRedo(); }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recovery.kind, save, stepRedo, stepUndo]);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="identity"><div className="logo-mark"><Glyph name="cube" size={20} /></div><div><strong>INTUIT<span>3D</span></strong><small>DESIGN WORKBENCH</small></div></div>
        <div className="title-divider" />
        <div className="project-title"><span className="project-dot" /><span>{workspace.document.name}</span><small>· revision {workspace.document.revision}</small></div>
        <div className="title-actions">
          <button title="Open preview project" aria-label="Open project" className="icon-button" onClick={() => fileRef.current?.click()}><Glyph name="open" /></button>
          <button title="Export preview project" aria-label="Save project" className="icon-button" onClick={save}><Glyph name="save" /></button>
          <button className="command-button" onClick={() => setPaletteOpen(true)}><Glyph name="search" size={15}/><span>Search commands</span><kbd>Ctrl K</kbd></button>
        </div>
      </header>
      <nav className="toolstrip" aria-label="CAD workspace tools">
        <div className="ribbon-group"><span className="ribbon-label">WORKSPACE</span><button className={view === 'solid' ? 'ribbon-button active' : 'ribbon-button'} onClick={() => setView('solid')}><Glyph name="cube" /> Solid</button><button className={view === 'sketch' ? 'ribbon-button active' : 'ribbon-button'} onClick={() => setView('sketch')}><Glyph name="sketch" /> Sketch</button></div>
        <div className="ribbon-group"><span className="ribbon-label">HISTORY</span><button className="ribbon-button" onClick={stepUndo} disabled={!workspace.past.length}><Glyph name="undo" /> Undo</button><button className="ribbon-button" onClick={stepRedo} disabled={!workspace.future.length}><Glyph name="redo" /> Redo</button></div>
        <div className="ribbon-group advanced"><span className="ribbon-label">EXPERIMENT</span><button className="ribbon-button" onClick={() => dispatch({ kind: 'pending-reference', enabled: !workspace.document.futureReference })}><Glyph name="plus" /> {workspace.document.futureReference ? 'Remove datum' : 'Future datum'}</button></div>
        <div className="toolstrip-right"><span className="stage-chip">ALPHA · PREVIEW ONLY</span><span className="avatar">I3</span></div>
      </nav>
      <div className="workspace-grid">
        <aside className="sidepanel browser-panel" aria-label="Model browser">
          <div className="panel-heading"><span>DESIGN BROWSER</span><span className="panel-count">{features.length}</span></div>
          <div className="browser-project"><Glyph name="cube" size={17}/><span>{workspace.document.name}</span></div>
          <div className="browser-subheading"><Glyph name="layers" size={15}/> Features <span className="tiny-tag">AUTHORED</span></div>
          <div className="feature-list">
            {features.map((feature, index) => (
              <button key={feature.id} className={`feature-item ${feature.id === selected ? 'selected' : ''}`} onClick={() => { setSelected(feature.id); if (feature.id.startsWith('sketch')) setView('sketch'); }}>
                <span className={`feature-icon ${feature.status}`}><Glyph name={feature.id.startsWith('sketch') ? 'sketch' : 'cube'} size={16}/></span>
                <span className="feature-main"><span>{feature.label}</span><small>{feature.id}</small></span>
                <span className="feature-position">{index + 1}</span>
              </button>
            ))}
          </div>
          <div className="browser-footnote"><Glyph name="alert" size={15} /> IDs are demonstration labels, not persistent B-rep topology.</div>
        </aside>
        <main className="editor-center" aria-label="CAD editor">
          <div className="viewport-header"><div className="view-label"><strong>{view === 'solid' ? 'Perspective' : 'Sketch plane · XY'}</strong><span>{view === 'solid' ? 'Shaded · edges' : '2D · millimetres'}</span></div><div className="viewport-actions"><span className={stale ? 'preview-tag stale' : 'preview-tag'}>{workspace.gesture ? (stale ? 'DRAGGING · STALE PREVIEW' : 'DRAGGING · UNCOMMITTED PREVIEW') : stale ? 'STALE LAST-GOOD PREVIEW' : rendered ? 'POLYGONAL PREVIEW · NOT EXACT' : 'NO VALID PREVIEW'}</span></div></div>
          <div className="viewport-stage">
            {view === 'solid' ? <SolidViewport document={rendered} selected={selected} onSelect={setSelected} /> : <SketchViewport document={workspace.document} onChange={update} onSelect={setSelected} onGestureStart={beginSketchGesture} onGesturePreview={previewSketchGesture} onGestureFinish={finishSketchGesture} onGestureCancel={cancelSketchGesture} canEdit={workspace.document.chronology.length < 1024} />}
            <div className="orientation-widget"><b>Y</b><span>+Z</span><small>X</small></div>
            <div className="viewport-hint">{view === 'solid' ? 'Drag to orbit · Wheel to zoom · Right-drag to pan · Click to select' : 'Drag holes or outline handles to edit dimensions · Shift 0.1 mm · Esc cancels · Arrow keys nudge'}</div>
            {stale && <div className="invalid-overlay"><Glyph name="alert" size={16} /><span>Current intent has invalid geometry. Shown mesh comes from revision {rendered?.revision}; dimensions in the inspector are the current, unresolved values.</span></div>}
            {!rendered && <div className="empty-overlay">No validated preview exists for this imported project. Repair the dimensions to generate a new preview.</div>}
          </div>
          <section className="timeline" aria-label="Feature history and dependencies">
            <div className="timeline-head"><div className="tab-group"><button onClick={() => setBottomTab('chronology')} className={bottomTab === 'chronology' ? 'active' : ''}>Authored timeline</button><button onClick={() => setBottomTab('dependencies')} className={bottomTab === 'dependencies' ? 'active' : ''}>Dependency graph</button></div><span className="timeline-note">Distinct authored & evaluation views</span></div>
            {bottomTab === 'chronology' ? <div className="timeline-rail">{workspace.document.chronology.map((entry, i) => <div className="timeline-event" key={`${i}-${entry}`} title={entry}><span className="timeline-index">{i + 1}</span><span>{entry}</span></div>)}</div> : <div className="dependency-list">{features.map((feature) => <div className="dependency-row" key={feature.id}><strong>{feature.id}</strong><span>← {feature.dependsOn.length ? feature.dependsOn.join(', ') : 'root'}</span><span className={`dep-status ${feature.status}`}>{feature.status}</span></div>)}</div>}
          </section>
        </main>
        <aside className="sidepanel inspector-panel" aria-label="Feature inspector">
          <div className="panel-heading"><span>INSPECTOR</span><Glyph name="layers" size={17}/></div>
          <div className="inspector-feature"><small>SELECTED FEATURE</small><strong>{features.find((f) => f.id === selected)?.label || 'Plate extrusion'}</strong><span>{selected}</span></div>
          <div className="inspector-section"><div className="section-head">PARAMETERS <span>mm</span></div>{(Object.keys(PARAMETER_LABELS) as DimensionKey[]).map((key) => <ParameterEditor key={key} name={key} value={param[key]} onCommit={update} />)}<p className="microcopy">Dimensions are local preview intent. A complete drag is one undoable edit; Esc cancels it. No OCCT constraint solve or B-rep evaluation has run.</p></div>
          <div className="inspector-section diagnostics"><div className="section-head">EVALUATION <span>{problems.length ? `${problems.length} issue(s)` : 'No local intent errors'}</span></div>
            {problems.length ? problems.map((problem) => <div className="diagnostic-entry" key={`${problem.code}:${problem.featureId}`}><Glyph name="alert" size={16}/><span>{problem.message}</span></div>) : <div className="diagnostic-clean"><Glyph name="check" size={16}/> Preview-input validation passed. Exact geometry remains unqualified.</div>}
            {workspace.document.futureReference && <button className="resolve-button" onClick={() => dispatch({ kind: 'resolve-reference', enabled: !workspace.document.referenceResolved })}>{workspace.document.referenceResolved ? 'Mark datum unresolved' : 'Resolve forward datum'}</button>}
          </div>
          <div className="inspector-section reference"><div className="section-head">PROJECT IDENTITY</div><div className="data-row"><span>Units</span><b>mm</b></div><div className="data-row"><span>Revision</span><b>{workspace.document.revision}</b></div><div className="data-row"><span>Provider</span><b>Three.js preview</b></div><div className="data-row"><span>STEP export</span><b>Unavailable</b></div></div>
        </aside>
      </div>
      <footer className="statusbar"><span className="status-indicator" /> <span>{problems.length ? `${problems.length} unresolved diagnostics` : 'Preview sketch intent admissible'}</span><span className="status-spacer" /><span>LOCAL ONLY</span><span className="status-separator" /><span>NO KERNEL VALIDATION</span><span className="status-separator" /><span><Glyph name="keyboard" size={14}/> Ctrl+K commands</span></footer>
      {storageWarning && <div className="recovery-alert" role="alert">{storageWarning}</div>}
      {recovery.kind === 'unavailable' && <div className="recovery-alert" role="alert">{recovery.message}</div>}
      {(recovery.kind === 'available' || recovery.kind === 'corrupt') && (
        <div className="recovery-backdrop">
          <section className="recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-title" data-testid="recovery-dialog">
            <h2 id="recovery-title">Local preview draft recovery</h2>
            {recovery.kind === 'available' ? (
              <p>A previously edited <strong>preview document</strong> is available at revision {recovery.document.revision}.
                {recovery.warning && <strong className="recovery-caution"> {recovery.warning}</strong>}
              </p>
            ) : <p role="alert">{recovery.message} Discarding is irreversible.</p>}
            <p>Choose explicitly before editing. Recovery is browser-local and cannot restore an undo stack, exact geometry, or STEP data.</p>
            <div className="recovery-actions">
              {recovery.kind === 'available' && <button autoFocus onClick={acceptRecovery}>Recover draft</button>}
              <button onClick={rejectRecovery}>Discard local draft</button>
            </div>
          </section>
        </div>
      )}
      {notification && <div className="toast" role="status" onClick={() => setNotification(null)}>{notification}<button aria-label="Dismiss notification">×</button></div>}
      <input type="file" ref={fileRef} hidden accept="application/json,.json" onChange={(event) => { const f = event.target.files?.[0]; if (f) void load(f); event.target.value = ''; }} />
      {paletteOpen && <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><div className="palette" role="dialog" aria-label="Command palette" aria-modal="true"><div className="palette-input"><Glyph name="search" size={19}/><input autoFocus placeholder="Find a command…" value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setPaletteOpen(false); if (event.key === 'Enter' && matching[0]) command(matching[0].execute); }} /></div><div className="palette-results">{matching.length ? matching.map((action) => <button key={action.id} onClick={() => command(action.execute)}><span>{action.name}</span><kbd>{action.hint}</kbd></button>) : <div className="palette-empty">No matching commands</div>}</div></div></div>}
    </div>
  );
}
