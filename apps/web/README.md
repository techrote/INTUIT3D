# INTUIT3D Workbench — first interactive UI slice

**Status: experimental, polygonal preview only. Not a geometry engine or STEP exporter.**

A local React/TypeScript/Vite and Three.js app that provides the first user-visible,
editable sketch-to-solid workbench experience independently of ongoing INTENT,
SKETCH and KERNEL development. **Nothing in this app is an authoritative CAD
model, constraint solution, valid OCCT B-rep, or engineering-qualified export.**

## Run and validate

From this directory with Node >=22 and network access to npm for first install:

```sh
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

Open `http://127.0.0.1:5173` locally. Vite binds only to loopback. No sign-in,
telemetry, external services, remote solver or cloud account is required once
dependencies are installed. Root `package-lock.json` is owned by INTEGRATION,
not this lane: integrator must reconcile the app package into root npm workspaces
and lockfile before merging, and run hosted browser/Windows checks.

## Current user workflow

- Inspect a two-hole plate in an orbit/pan/zoom Three.js perspective viewport;
  click the approximate body to select the feature.
- Switch to Sketch, see a scaled 2D profile and holes, drag a hole centre to
  edit hole pitch in 1 mm increments, or enter exact millimetre dimensions in
  the Inspector (width, depth, thickness, diameter, pitch).
- See sketch-intent diagnostics on zero/negative/nonfinite parameters, touching
  or overlapping holes and holes outside the plate. An invalid edit remains
  editable; the viewport is marked as a **stale last-good polygonal preview**.
- Inspect authored chronology separately from feature dependency relationships.
- Use undo/redo, Ctrl+K command palette, Ctrl+S local preview-project export,
  Ctrl+O local import; the JSON schema is strictly versioned and validated.
- Add an unresolved future datum and explicitly resolve it without losing the
  authored operation. This models the UX state, not INTENT's actual solver.

## Engineering honesty / known gaps

- Three.js Shape/ExtrudeGeometry is **polygonal display geometry** with 72
  radial subdivisions, never validated exact geometry or STEP.
- No persistent semantic face/edge references, actual constraint solver,
  native OCCT provider, body validation, authoritative edit graph or durable
  undo history across a save/reopen. `preview-ready` is UI admissibility only.
- Invalid imported designs have **no** fabricated last-good mesh. A bad edit
  on an initially valid workspace may show an explicitly stale prior mesh.
- Authoring chronology is a local operation summary; not a tamper-evident,
  replay-validated authoritative journal. The authoritative INTENT package
  exists separately in Draft PR #8 and must not be silently replaced by this.
- The first handoff to INTEGRATION is a versioned adapter boundary. Once INTENT,
  SKETCH and KERNEL are qualified, replace the demo model rather than parallel
  maintaining two sources of engineering truth.
- Browser appearance/interaction must be tested on actual installed dependencies
  and CI. Node unit tests alone are not graphical acceptance.

## Ownership

All changed paths are confined to `apps/web/**`. The WORKBENCH lane owns this
source; INTEGRATION owns root lockfile, shared configuration and merge gates.

## Gesture and stale-preview safety (WORKBENCH-001 continuation)

- A sketch-hole pointer gesture previews edits without growing the edit journal,
  then commits **one** undo entry at pointer-up. Pointer cancellation or Escape
  restores the original parameter/revision. No-op drags have no journal effect.
- Left/right drag direction is frozen from the selected hole; crossing the sketch
  origin does not reverse movement. Shift-drag snaps to 0.1 mm; ordinary drag
  snaps to 1 mm. Keyboard-focus either hole and use arrow keys for pitch updates
  (Shift = 0.1 mm).
- Invalid proposals are **not silently clamped**: overlap, negative pitch and
  boundary violations remain diagnosable, with stale preview clearly marked.
- Undoing into invalid history reconstructs the last valid preview only from
  earlier authored history; geometry from the future revision is never shown
  as historical truth. An imported invalid document still has no last-good mesh.
- The preview journal's 1024-entry capacity fails closed **before** an edit
  would render the project unsaveable.
- Verification: `node --experimental-strip-types --test src/*.test.ts`
  exercises gesture, replay, geometry-admissibility and import scenarios without
  browser dependencies. Installed dependency typecheck, Vite build, real browser
  pointer capture/rendering and human UX acceptance **remain required** and
  must not be inferred from Node tests or TSX syntax parsing.

## Browser-local preview crash recovery (WORKBENCH-001)

The workbench now writes **committed** preview documents to a current/previous
browser `localStorage` recovery pair. On reload, the previous draft is
**offered for explicit recovery or discard before any demo autosave occurs**.
A corrupt newest entry can be recovered from an independently validated earlier
entry. Quota/storage failures show a persistent warning: use the explicit
`Ctrl+S` preview JSON export. This is a best-effort convenience, not durable
filesystem storage; clearing browser data deletes it. Pointer-move previews are
never autosaved until the one-step drag transaction commits.

Recovery uses the existing strict `intuit3d.web-preview` v1 parser. Invalid but
well-formed geometry remains editable on recovery, with **no fabricated
last-good mesh**. The recovery envelope has a noncryptographic accidental-damage
checksum; it does not provide security against malicious storage tampering,
guaranteed power-loss durability, multiple-project history, restored undo stacks,
authoritative INTENT persistence or STEP. The source is confined to
`apps/web/**`; it is not a replacement for engineering project files.

`node --experimental-strip-types --test src/*.test.ts` includes ten new
storage failure/corruption/restart scenarios. The full React/Vite browser gate
remains required before merging while INTEGRATION reconciles the root lockfile.
