# Source-owned closed-contour insertion v1 — SKETCH #338

`@intuit3d/sketch/closed-contour-insertion/v1` is a **SKETCH-only analytic contract**, not an admitted RUNTIME journal operation or native STEP capability.

## Mechanical user journey

A model-backed user draws and closes a four-vertex 120 × 80 mm plate. After a hole is dimensioned relative to `panel:vertex:2`, they select the actual source line `panel:edge:1` and request a mounting tab with two positions: (140,20) and (140,60) mm.

`insertClosedContourTab(source, selection, command)` independently checks source signature, current solved selected contour and edge identity. It replaces the selected edge with three ordered edges, constrains both new vertices by real signed-X/Y offsets from the original fixed datum and re-solves/discovers the entire sketch. The selected edge ID is **retired explicitly** and returned as such; it is **not reused to mean a different piece**. The four original point IDs, their constraints, the other three edge IDs and the hole reference retain identity. A new successor profile selection is issued because the set of line IDs really changed.

`inspectTabbedClosedContour` reconstructs all six semantic handles and constraints *from serialized authoritative sketch*, not from mesh/pixel order. `editTabbedContourVertex` changes one non-datum handle using actual solver dimensions, admits the successor profile, checks unrelated components and preserves proven reference-bound circular holes. A datum move is refused rather than silently translating unrelated geometry. Both operations are deterministic from canonical source and have explicit source stamps; the caller's document is never mutated on success or refusal.

Source schema and public declarations: `closed-contour-insertion.mjs` and `.d.mts`. Executable demonstration: `node packages/sketch/examples/closed-contour-insertion.mjs`; qualification: `node --test packages/sketch/test/closed-contour-insertion.test.mjs`, `npm run typecheck --workspace @intuit3d/sketch`, `npm run check:workspace`.

## Required consumer handoff — NOT automatically enabled by this PR

RUNTIME's currently accepted `sketch.contour/v1` transaction only recognizes `create`, `edit` and `drag` commands with **v1 closed contour geometry**, and its existing edit replay still invokes the fixed-count inspector. A source replacement performed outside the authoritative revision-fenced journal is **not permitted**.

RUNTIME must review a new structural operation/version that:
1. binds the exact canonical whole-project archive, project ID, revision, selected profile, sketch signature, retired edge and external feature dependencies;
2. independently replays the SKETCH `insertClosedContourTab` command on the authoritative source and compares the entire acceptance, semantic remapping and successor profile before one undoable INTENT event;
3. refuses any cross-feature reference to the retired edge, rather than silently reconnecting to one of the new edges; never claims that the former semantic profile ID is unchanged;
4. treats geometry beyond the pinned C++ support envelope as explicitly pending/unsupported, not as a successful STEP build.

WORKBENCH must source-pick an edge, collect two sketch-local vertices, show retirement/selection change explicitly, submit the new command through RUNTIME, then test dimension edit, undo/redo, save/reopen/reselection and negative topology cases with real pointer input. This package does not modify or enable those consumers.

## Safety / limitations

- Only one two-vertex insertion into an existing **v1 drawn contour** is supported. The inspector/edit contract is for that one tab; repeated insertion, arbitrary trim/delete, nested loops, chamfers and topology-identity remapping are not implied.
- Insertion refuses under/overconstrained, contradictory, invalid-hole, touching/crossing, ambiguous predecessor edge, external line constraint, stale source, ID collision, budget and unsupported source topology. The two inserted points cannot both be collinear with the retired edge (exact encoded-binary64 predicate): a visually unchanged outline is not a tab.
- On insertion and dimension edit, the successor contour is checked against every other discovered material contour for exact intersection, contact or nesting, with a distinct `contour_conflicts_with_other_profile` diagnostic. Geometry is rechecked after dimension edit, not just at insertion.
- Existing sketch-local point references remain stable, but **cross-lane body/face/edge references require explicit RUNTIME/INTENT invalidation**. Retired source-edge references must not be rebound.
- The current polygon guards are binary64 analytic predicates, not a general exact-predicate planar arrangement system.
- The exported `previewOnly:true`, `nativeExact:false` and `independentStepQualified:false` are intentional. A fresh pinned OCCT8 C++ + independent STEP witness is mandatory before describing an inserted tab as physically qualified.

**Disposition:** Integration must independently review the source-only SKETCH candidate, verify exact-head hosted tests, and guardedly merge. This PR must not be presented as resolving the full #338 user workflow or #74 physical CAD acceptance.
