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
and a screenshot, plus loss-of-window-focus cancellation without a phantom
authored revision, in addition to its manipulation/recovery checks.
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


## Fail-closed sketch coordinate projection (WORKBENCH continuation)

The sketch viewport now uses `src/sketchProjection.ts` to invert its current
SVG-to-screen affine transform in a bounded, DOM-independent calculation.
Absence of `getScreenCTM()`, rank-deficient/singular transforms, nonfinite
coefficients, or out-of-range results are **not** substituted with the origin
or raw screen coordinates. Cursor readouts disappear, new pointer gestures
are refused, and active hole-pitch/outline-dimension gestures are cancelled
with no authored revision when projection becomes invalid. A normal gesture
still uses the frozen scale and existing atomic preview edit contract.
The semantic `document` React prop no longer shadows browser DOM
`globalThis.document` in the visibility-loss listener (the strict TS2339
error reproduced by INTEGRATION #21).

`sketchProjection.test.ts` supplies 10 executed Node regression scenarios
for identity/translated/skewed/rotated/mirrored transforms, missing CTM,
singular/near-singular matrices, nonfinite inputs, extreme scales and
immutability. The existing Chromium CDP fixture `test:browser:handles` is
extended to inject missing and singular CTMs during real cursor and pointer
events, checking rollback and no phantom edit revision. The CDP scenario
is **committed but not yet evidence of execution**; current WORKBENCH-only
branch CI cannot install the Integration-owned unified root lockfile.
INTEGRATION must reconcile this exact source to #21 and run strict
TypeScript, full browser interactions, screenshots and Ubuntu/Windows
workspace gates before admission. No genuine sketch constraint, exact
geometry or independent human usability acceptance is implied.

## Interactive 3D extrusion preview thickness (WORKBENCH v1)

The **↕** gizmo beside the polygonal plate in Solid view proposes an extrusion
thickness by projecting the camera's world-Y axis into screen-space. Dragging the
gizmo with the primary pointer button performs one undoable preview transaction;
**Shift** changes snapping to 0.1 mm. Focus the gizmo and use **Arrow Up/Down**
for keyboard editing. **Escape**, pointer cancellation, hiding the document or
losing window focus abandon an uncommitted gesture. Camera-axis projection is
frozen at pointer-down; an edge-on/invalid projection disables new direct edits
rather than silently inventing a drag scale.

An invalid proposal (including zero/negative thickness) remains in the editable
preview intent, with an explicit blocked extrude and labelled stale last-good
polygonal mesh; no mesh is silently promoted to current exact geometry.
The viewport cannot author OCCT faces, topology IDs, SKETCH constraints, STEP
data or exact B-rep extrusion. App-owned demo feature IDs and browser-local JSON
are not the durable INTENT document. The projected axis is exposed on the HTML
gizmo only for deterministic browser interaction tests.

Deterministic source checks:
`npm test --workspace @intuit3d/web`. The existing real Chromium CDP harness
(`npm run test:browser:handles --workspace @intuit3d/web` after `npm run build`)
now includes an actual rendered Three.js thickness drag, blur rollback, keyboard
nudge, undo/redo and screenshot evidence. Browser execution and STEP/native
geometry acceptance must be reported separately.


### Preview-only dimensional calculator (v1)

Select the **fx** button beside a dimension to enter arithmetic and `mm`, `cm`, `in`: `1in + 5mm`, `2*(35mm + 5mm)`, `120/2`. Bare numbers are interpreted as millimetres at the output; mixed additions treat bare terms as millimetres. Multiplication/division checks physical length dimensions; unsupported terms, nesting, zero division, underflow and nonfinite/oversized results fail closed with an inline, repairable message. Addition/subtraction also refuses a nonzero input that disappears entirely at binary64 precision, or a near-ULP subtraction residual whose cancellation makes the displayed precision unreliable. For example, `120mm + 1e-15mm` is rejected without journalling a false no-op. These checks detect specific loss modes, not all floating-point rounding errors or engineering tolerance compliance. Enter commits one numeric preview edit; Escape cancels before blur. Negative/zero values remain editable invalid intent with stale preview. Expressions are **not** stored or re-evaluated as parametric bindings; save/reopen retains only the resulting binary64 scalar. This interface is `intuit3d.web-preview.dimension-expression/v1`, not the authoritative INTENT evaluator, SKETCH solver, or OCCT exact provider. Real Chromium evidence is exercised by the existing `test:browser:handles` script when an installed workspace and built Vite app are available.

## Confirmed local preview-project open/new (WORKBENCH-001)

Opening a validated `.i3d-preview.json` file, or invoking **New mounting plate
example**, now opens a keyboard-accessible replacement review rather than
silently erasing the active document. The review compares parameter values,
project identity, forward-reference state and authored chronology, and exposes
incoming preview diagnostics. **Cancel** leaves the current document and its
undo/redo intact. **Replace** explicitly clears the old undo/redo; no B-rep,
STEP or authoritative model is imported or invented. Invalid but schema-valid
intent is loaded for repair with no fabricated prior geometry.

Asynchronous file reads are generation-fenced: a late older file cannot replace
a newer selection or canceled review. Oversized, malformed or unsupported
project files fail closed without changing the active workspace. In the browser,
imported revision-zero projects are also eligible for local recovery, but
browser-local recovery is not a replacement for saving distinct project files.

Tests: `src/importReview.test.ts` checks comparisons, signed zero, reference/
chronology changes and stale read tickets. The Chromium handle smoke test
exercises a real File-input replacement, cancel, invalid imported preview and
no-undo acceptance. Neither test confers precision CAD or human acceptance.

## Model-backed experimental native STEP (WORKBENCH #64)

Model mode (not the legacy preview sandbox) offers an **opt-in** local-only
native STEP action. It consumes the versioned browser client from RUNTIME
PR #69, the authoritative INTENT model archive and the SKETCH-admitted profile.
It does not install a second browser-side CAD/Boolean engine.

On a host with the pinned experimental OCP Python environment:

```sh
npm ci
python3 -m pip install -r native/requirements-prototype.txt
npm run dev:experimental-native-host --workspace @intuit3d/web
# second terminal
npm run dev --workspace @intuit3d/web
```

Open `http://127.0.0.1:5173`, enter **Model-backed CAD**, and copy the
`LOCAL_PROVIDER_URL` and `LOCAL_PAIRING_TOKEN` displayed in the first
terminal into the native section of the inspector. The session token is held
in React memory only, is not saved to the model archive or localStorage, and
is invalid after the host restarts. Click **Build and download experimental
STEP**. The provider runs outside Vite; do not import native Node modules in
browser source. The server binds loopback and permits only the configured
local Origin. `INTUIT3D_WEB_ORIGIN` can specify a different Vite origin.

The UI shows progress, cancellation and explicit unresolved error states.
Editing the model, undo/redo, opening or replacing an archive, or changing the
pairing aborts the pending request. The current canonical model archive is
compared again immediately before verified bytes are published by the browser.
No historical STEP is shown as current. Unsupported sketches cannot request
a native build. STEP bytes are emitted only after RUNTIME's browser-client
SHA-256/length verification.

**Evidence boundary:** the actual provider is experimental OCP 7.9.3.1,
with same-engine STEP readback only. No production OCCT 8.0.1, independent
STEP external consumer, authoritative in-viewport B-rep, or human usability
acceptance is implied. The 3D viewport remains clearly labelled tessellated
preview even after a physical STEP download.

`npm run test:browser:handles --workspace @intuit3d/web` also runs the
new Chromium `model-native-smoke.mjs` regression: a real React click and
binary browser download against an **explicit synthetic HTTP responder**,
plus cancellation after a model edit, fresh revised export and three
screenshots. It does **not** qualify actual OCCT geometry. Actual OCP evidence
requires running the above local host and independently checking STEP in a
separate CAD implementation.

### Retrospective selected-hole layout edit (experimental workbench)

In the model-backed inspector, **Retrospective hole layout** selects stable authored circle IDs. Set independent X-spacing, Y-spacing and bore-diameter percentages and apply once. WORKBENCH uses the accepted `runtime.resizePlateHoleLayout` contract, an explicit selection-centre pivot, the SKETCH solver and one undoable INTENT event; it does **not** modify preview triangles or create an associative pattern. Overlaps/refused dimensions preserve the original document. Undo/redo and Save/Open retain IDs, and edits revoke old STEP receipts. Opt-in Live rebuild creates new revision-fenced experimental physical STEP bytes when the local provider is paired. Production OCCT 8.0.1 and independent external STEP still require separate qualification. Browser regression: `npm run test:browser:handles --workspace @intuit3d/web` (actual Chromium, synthetic HTTP provider for the UI test).

## Two-click circle authoring (model-backed SKETCH)

In **Model-backed CAD → Sketch**, choose **Draw circle · 2 clicks**. The
first click records only a temporary centre; the second defines the diameter
from the current SVG millimetre projection (0.5 mm snapping). Escape or Cancel
abandons the tool with **no authored event**. RUNTIME/SKETCH admits the complete
circle into the single authoritative journal or refuses overlaps/out-of-bounds
profiles without committing a partial feature. A successful circle has a stable
hole ID, can be dragged/dimensioned, and participates in undo/redo, archive
save/reopen and native STEP invalidation. The sketch shows a temporary ghost
circle while drawing; it is never B-rep or exact geometry.

Regression: `node --experimental-strip-types --test src/circleDrawing.test.ts`
and the real Chromium `npm run test:browser:handles --workspace @intuit3d/web`
(two actual pointer clicks, one journal revision, undo/redo and screenshots).

## Model archive lifecycle: project-aware save and safe drop-to-open

The model-backed CAD editor now gives JSON archive downloads a basename derived
from the authoritative INTENT project ID and revision. A save request refuses
archives over the same **4 MiB** byte limit that the isolated Worker import
enforces, rather than generating an archive this app cannot reopen. The browser
can confirm that a download was *requested*, not that it reached persistent
filesystem storage: verify the JSON exists in Downloads. A visible export-state
chip flags unexported journal edits, and a browser-native unload guard warns
while such edits remain. Edits after undo/redo conservatively count as changes
until another download request.

Use Ctrl+O, Open model archive, or drag and drop **exactly one** local model JSON
onto the model-backed workbench. All paths use the same bounded file-read,
isolated Worker validation, cancellation fence, and explicit replacement modal.
The modal compares incoming/current authoritative project IDs, revisions and
undo/redo frame counts, and warns if the current in-memory model has not been
exported. Cancel leaves the journal untouched; confirming a newly created
project leaves it unsaved. No preview geometry or STEP receipt is treated as
the archive's source of truth.

Tests: `npm test --workspace @intuit3d/web`; `npm run typecheck --workspace
@intuit3d/web`; `npm run build --workspace @intuit3d/web`;
`npm run test:browser:handles --workspace @intuit3d/web`. Chromium acceptance
exercises real file input, browser drag/drop, multi-file refusal, project-aware
download name and cancel-before-replacement. Neither these tests nor Worker
isolation establish that the owner's original 40 KiB Windows/Firefox model
no longer hangs; issue #177 still requires actual private-file replay.

## Stale parameter spreadsheet: explicit semantic conflict recovery

This is a **model-owned** revision-fenced workflow using INTENT's accepted
parameter-sheet rebase/resolution contracts (#205/#213), not browser-side
arithmetic or local document authority.

1. In Model-backed CAD, edit the formula in **PARAMETER FORMULA TABLE** but
   leave it uncommitted. Use the separate named-parameter inspector or a direct
   dimension handle to change the authoritative model.
2. Your unsaved formula remains visible with **Draft from revision N; current
   model revision M**. Click **Review draft against current model**.
3. A non-conflicting INTENT rebase shows a preview. Otherwise, exact semantic
   conflicts are listed by type and feature ID. Review/checkbox **each**
   overridable conflict individually; if a journal event ID was taken, type
   one explicit, unique replacement ID before **Review selected conflict
   approvals**. A formula reference now pointing at a different semantic ID
   cannot be overridden; revise the draft instead.
4. Compare original-vs-current evaluated scalar values and the invalidated
   feature list. Only **Commit parameter table** writes to INTENT. The result
   is one undo frame. Undo, redo, save and reopen operate on the same
   authoritative journal. **Discard drafts** abandons the local editor state.
5. If the project was replaced, its unsaved draft is discarded. If ancestry is
   divergent or the user edits the document again during review, INTENT refuses
   the stale proposal; review again or discard. No pending/unsupported preview
   becomes a native or independently exact solid.

Deterministic tests:
\`node --experimental-strip-types --test apps/web/src/parameterFormulaRecovery.test.ts\`
and \`npm run test:browser:handles --workspace @intuit3d/web\`. The latter
uses actual Chromium keyboard/click interactions to preserve a 16 mm draft
while another inspector commits 13 mm, requires explicit conflict approval,
commits and undoes both operations separately. Production STEP and Windows
Firefox remain separate qualifications.

### Private owner archive #177: Windows Firefox human replay (not yet qualified)

Use a **local** current-main build and the original ~40 KiB saved model
already supplied privately to the owner; do not upload it or copy its JSON
into public issues, test fixtures or logs.

1. Open a new Firefox window on Windows; record the Firefox version and
   hardware acceleration/GPU information from \`about:support\` (exclude any
   identifying file paths). Keep Browser Console open and observe that New
   sketch-first project can open a normal replacement modal.
2. Click **Open model archive**, select the original local revision-11 JSON
   in the OS picker, and note whether the workbench remains responsive and
   displays Worker **reading → validating → transferring** progress before
   the explicit Replace confirmation. Try Cancel if an import is pending.
3. If validation succeeds, click **Replace with model archive**. Verify
   project ID, revision, journal/undo frame count, sketch/3D navigation, a
   small dimension edit, Undo and Redo. Save the resulting archive to a new
   local filename; reopen and verify authoritative identity, dimensions and
   history. Do not treat mesh visibility or STEP alone as validation.
4. If Firefox freezes **before** confirmation, note the last observable
   progress stage, whether an ordinary New sketch modal responds, and whether
   the browser UI, content process or GPU process is unresponsive. Record
   sanitized Console errors and Graphics status, and whether \`about:crashes\`
   has an entry. For discrimination, repeat in a clean Firefox profile or with
   acceleration toggled *only after preserving the original report*.

Mark this acceptance **unqualified** until the original private file and
Windows/Firefox environment are actually replayed. A synthetic Chromium
test, Worker-side read, and persistent renderer are risk reductions, not
proof of the cause or resolution of #177.


## Authoritative model crash recovery — browser-local checkpoints

The **model-backed CAD workbench** (not the separate legacy preview sandbox)
retains up to six recent edited browser sessions in origin-scoped IndexedDB.
A 450 ms quiet period after an accepted authoritative journal change stores
the same RUNTIME model archive used by **Save model archive**, including
project ID, revision and undo/redo frames. A newly opened, unedited template
does not overwrite earlier sessions. Multiple tabs have distinct session IDs,
so there is no shared mutable CAD document or cross-tab journal authority.

Expand **Browser-local crash recovery** beneath the title bar. For the desired
project/revision, click **Review & restore**. The saved archive is passed through
the existing isolated validation Worker and then the normal identity/revision
replacement-confirmation dialog; **Cancel** leaves the current model untouched.
A recovered draft is marked **unexported**, even if the older browser session
requested a download. **Forget** removes that local checkpoint.

This is best-effort recovery, **not** a filesystem save, guaranteed persistence,
cloud sync, backup service or native-solid/STEP cache. Private browsing, browser
storage eviction, quota/security settings, a sudden power loss before the queued
transaction completes, and profile deletion can remove checkpoints. Storage
errors are surfaced in the disclosure; export project archives regularly.
The 4 MiB limit and journal validation remain enforced. Never treat these
checkpoints as evidence that Windows Firefox issue #177 is resolved.

Executable qualification: \`npm test --workspace @intuit3d/web\`,
\`npm run typecheck --workspace @intuit3d/web\`, and
\`npm run test:browser:handles --workspace @intuit3d/web\`. The browser test
covers actual Chromium editing, IndexedDB checkpointing, cancel, full page
reload, Worker review, confirmed restore and undo/redo. The original private
40 KiB owner archive selected in Windows Firefox still needs the separate,
privacy-respecting human replay above.

## Selected-hole copy and batch removal

In the model-backed CAD workbench, choose **Sketch** and Ctrl/Cmd-click hole centres or use the **Retrospective hole layout** checkboxes. Under **Duplicate selected holes**, enter signed X/Y offsets in millimetres (initially +20, 0) and click **Duplicate selected holes**. This copies 1–32 selected admitted holes in **one undoable INTENT/SKETCH event**, assigning each copy a new durable circle/constraint ID. The original positions and diameters remain unchanged. These are independent, *non-associative* circles: editing the sources later does not move the copies. The new copies become the current selection, so they can be moved, resized or removed as a group.

**Remove selected custom holes** deletes the explicitly selected user-added/copy holes in one undoable operation. The two base circles are intentionally protected because plate dimensions depend on their identities. An invalid selection, zero/NaN offset, collision, outside-plate rim, stale ID or SKETCH refusal does not publish a partial model revision. Rectangular physical plate containment is checked against the admitted solved profile, not a fabricated arbitrary-contour bounding box. Any successful operation invalidates previously built STEP receipts; the onscreen solid remains an **analytic preview**, not an independently qualified production C++ geometry result.

To verify: start the local workbench, select both seed holes, stamp X=20/Y=0 and observe two independently editable new holes, then Undo/Redo. With only the two new IDs selected, remove them, Undo, save the archive, reopen and inspect the restored IDs/history. Automated checks: `npm test --workspace @intuit3d/web` and `npm run test:browser:handles --workspace @intuit3d/web`. The browser suite runs actual Chromium pointer events; Windows Firefox original private archive issue #177 remains a separate unqualified human gate.

## Real 3D CAD preview camera controls

The authoritative RUNTIME workbench offers clickable **ISO, TOP, FRONT,
RIGHT, FIT** presets. Orthogonal views follow the actual solved sketch axes.
FIT conservatively frames the entire current body (including extrusion
thickness) without changing the user's chosen orbit. Manual orbit/pan marks
the preset as custom. Editing dimensions preserves camera, GPU canvas and
WebGL context; camera operations never author an INTENT event or change STEP
validity. These are analytic display views, **not exact geometry**.

Unit tests cover orientations, narrow viewport bounds and invalid inputs.
Real Chromium smoke clicks the presets, checks actual Three.js camera
coordinates, unchanged journal revision and WebGL2 context. Windows Firefox
and private #177 archive acceptance remain unqualified.

## Selecting sketch holes from the real 3D canvas

In **Solid** mode, switch to **TOP** or **ISO**. Click a visible circular opening in the actual WebGL canvas, rather than its thickness grip or a toolbar button. The selected hole ID appears at the upper left and in the model-backed inspector; Ctrl/Cmd-click adds another ID to the existing group. A pointer drag or wheel gesture remains camera navigation, not a model edit. **FRONT/RIGHT** do not infer occluded hole identities through the solid.

The preview ray is intersected with the current top plane and matched only against existing solver-authored circular holes; it never creates triangle/face IDs or modifies the INTENT journal. Selection does not advance revision, invalidate or manufacture native STEP, nor recreate the WebGL context. Editing the chosen hole remains an authoritative sketch/inspector operation. For acceptance, the Chromium browser smoke uses a real CDP pointer click on the projected solved hole, verifies selection and unchanged revision/context, and ensures a stationary click does not misleadingly mark the camera as manually orbited. Firefox/Windows original archive #177 remains unqualified.


## Contextual 3D-picked bore editing (source-owned)

In **Solid** mode, choose **TOP** and click a visible circular through-hole
in the real WebGL preview. Its stable SKETCH ID appears in the contextual
**Selected bore** panel at the upper left, with solved X/Y centre and diameter.
Enter new X and Y millimetre coordinates and click **Move centre** to make
one bounded, solver-admitted, undoable sketch edit. **Apply Ø** likewise
resizes the selected bore through RUNTIME/SKETCH. Enter confirms a field;
Escape restores the current solved dimension without changing the model.
A multi-selection or edge-anchored hole cannot be incorrectly edited as a
single Cartesian circle; use the existing model-backed selection/edge panel.

Reproduce: Solid → TOP → click holeA → change X 35→36 → Move centre →
verify changed hole and revision, then Ctrl+Z → restored X 35 → change
diameter 12→13 → Apply Ø → Ctrl+Z → 12 mm restored. Save/reopen the
model archive and verify stable IDs. Neither the camera nor Three.js canvas
is replaced by these edits; cached STEP bytes are revoked. This is a
semantic sketch edit and tessellated preview, **not physical OCCT proof**.
The original Windows Firefox private-archive import #177 remains an
independent unqualified acceptance gate.


## Pinned C++ STEP source-custody download (not independent acceptance)

The **LOCAL NATIVE STEP** panel retains the existing experimental OCP path,
but additionally exposes **Download pinned STEP evidence ZIP** when RUNTIME
has produced a verified **OCCT-cxx-8.0.1**, same-revision native STEP. This
action calls `captureCurrentStepEvidence()` synchronously on the actual
button click, then stores its *single returned snapshot* in an uncompressed
ZIP with exactly three files:

- `current.archive.json`: canonical authoritative INTENT model + undo archive
- `current.receipt.json`: source, pinned producer and STEP checksum metadata
- `current.step`: unmodified verified native STEP bytes

Rebuild a model with a pinned OCCT8 C++ provider, click this button, extract
the ZIP and supply these unchanged files to the independent STEP session
consumer described in `conformance/external-cad/SESSION-STEP-GATE.md`.
Capture an **earlier same-project revision of the same cut feature** before
making a retrospective edit, then rebuild and capture the edited revision.
Edits, undo, archive replacement and provider changes revoke the native
receipt; a stale or OCP-only result leaves the pinned evidence action disabled.
The ZIP filename is sanitized, and only one browser download is requested.

This is source **custody**, not proof of which C++ binary was compiled or
that a non-OCCT importer accepted the geometry. The actual native worker must
run and the independent consumer must verify both physical shapes before #74
can close. Browser test fixtures using synthetic HTTP STEP cannot qualify
that gate. No owner-private #177 archive is bundled automatically; the ZIP
contains only the current intentionally exported user model.

Unit acceptance: `node --experimental-strip-types --test
apps/web/src/stepEvidenceBundle.test.ts` (or `npm test --workspace
@intuit3d/web`). Chromium browser smoke additionally asserts the OCP/synthetic
test host cannot enable pinned-custody export. The real pinned C++ browser
click and Windows Firefox original-archive replay require separate evidence.
