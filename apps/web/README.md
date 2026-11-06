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

## Sketch cursor and visual snap diagnostics (preview only)

The SVG sketch viewport displays a millimetre cursor readout and highlights
nearby plate corners, edge midpoints, hole centres, the origin and a 10 mm
visual grid. Ranking is deterministic in screen-pixel distance (14 px maximum),
with semantic preview targets winning exact ties against grid marks. The
pointer coordinate transform respects SVG screen scaling and upward-positive
sketch Y. The hover is **read-only**: it cannot create a constraint, move
geometry, modify a revision or assert a solved sketch. When the current
profile is inadmissible, plate/hole candidate snaps are suppressed; only
the visual grid remains. This does not yet consume the versioned SKETCH
snapping or solver-admission provider.

`src/sketchCursor.test.ts` supplies deterministic/adversarial cursor probes;
`npm run test:browser:handles` includes an actual Chromium mouse hover at
the origin, a visual-snap readout assertion, a no-authored-edit assertion
and a screenshot, in addition to its existing manipulation/recovery checks.
The browser gate must execute on the exact integrated head before merge.

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

## Multiple-tab recovery collision guard (WORKBENCH-001 continuation)

Recovery now captures the raw **current and previous** localStorage slots on
mount and after each successful autosave. Before saving or discarding, a
synchronous compare checks that neither slot has changed. A different tab's
edit (or corruption) causes an explicit warning and **no attempted overwrite**;
the current in-memory edits remain available for manual preview JSON export.
A stale recovery dialog refuses to accept/discard an overwritten draft, and
cross-tab `storage` events surface the conflict before the next edit.

Seven executable tests exercise two-tab writes, divergent backup slots, stale
discard, corrupt data, denied storage, quota failures and same-tab progression.
This is **optimistic, best-effort preview data-loss prevention**, not atomic
multi-tab compare-and-swap: localStorage does not offer an inter-tab transaction,
so two simultaneous writes may still race between comparison and mutation.
No authoritative INTENT journal, cross-session undo or CAD file durability is
claimed. External preview JSON export remains the recovery fallback.


## Direct sketch dimension handles (WORKBENCH-001 continuation)

The sketch viewport now has three separate, keyboard-focusable dimension
handles for **plate width**, **plate depth** and **hole diameter**, alongside the
existing hole-pitch controls. Width/depth expand symmetrically about the sketch
origin; the diameter handle expands around its hole centre. Pointer-down freezes
the millimetre scale and authored starting value, so changing sketch extents
during the drag does not accumulate drift or reverse sign. Horizontal arrows
adjust width/diameter, vertical arrows adjust depth; Shift selects 0.1 mm rather
than 1 mm. Pointer-up commits **one** preview-journal/undo event; Escape or
pointer cancellation reverts the entire drag. Invalid proposed dimensions and
overlapping profiles are deliberately retained for diagnostics, with any older
polygonal mesh explicitly stale. This is preview-parameter interaction, **not**
a sketch solver, exact B-rep, stable topology or direct manipulation of OCCT.

Run `npm test --workspace @intuit3d/web` and the complete exact-head build and
browser pointer/keyboard tests before admission. `outlineDimension.test.ts`
is a deterministic adversarial test corpus for frozen coordinate transforms,
fine snapping, ignored perpendicular keys, undo/reopen and contradictory intent.

### Real-browser admission fixture

After the Integration-owned combined lockfile is admitted, build the workbench
(`npm run build --workspace @intuit3d/web`) and execute
`npm run test:browser:handles --workspace @intuit3d/web` on Ubuntu with Chromium.
The standalone CDP harness opens the real React/Three workbench, takes a WebGL
screenshot, switches to sketch, performs a **physical mouse drag** on the width
handle, verifies a single authored revision and undo/redo, applies a diameter
arrow-key edit, reloads, and explicitly recovers the two edited dimensions.
It produces five PNG frames plus JSON in `apps/web/browser-evidence-handles/`.
No result is claimed until the harness actually executes; source-only checks
and pure geometry unit tests are not substitute graphical evidence.
