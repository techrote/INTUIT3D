# Atomic multi-position cut drag/drop, v1

**Public API:** `@intuit3d/feature-ops/ordered-cut-move/v1`.
**Owner:** FEATUREOPS (`packages/feature-ops/**`). No changes to INTENT, SKETCH, RUNTIME, KERNEL, WORKBENCH, shared CI or manifests.

A body timeline with extrusion → cut A → cut B → cut C → cut D can move
cut A **after cut D in one user action**. This is a real *dependency execution*
reorder, not a cosmetic journal move. The original source sketches, bodies,
cut IDs, blind/through extents and authored chronological event order survive.
INTENT's accepted `previewBodyCutSwap` validates all three adjacent semantic
swaps on successive staged documents; only after **all three** pass does
RUNTIME commit their eight events as **one undoable transaction**.

## WORKBENCH/RUNTIME consumer

1. Supply the explicitly selected `targetBodyId` in the selected local XY mm
   project, with `format`, `version`, `expectedProjectId` and
   `expectedRevision` to `inspectOrderedBodyCutMove(history,request,services)`.
2. The inspector returns the actual dependency `writerOrder`, real SKETCH
   `cutSelections`, and `dropAfterWriterIds`. It refuses ambiguity, invalid
   sketches, unsupported body writers and missing RUNTIME admission. Do **not**
   substitute journal chronology or transient face indices.
3. On drag/drop commit, pass `cutFeatureId`, `dropAfterWriterId`, exactly
   the returned `expectedWriterOrder` and `cutSelections`, plus a fresh
   durable `eventIdPrefix`, to `moveOrderedBodyCut`. No-op positions, stale
   revisions, wrong bodies, mismatched profile/extent selections and noncommuting
   INTENT swaps fail before committing. The selected cut must remain on the
   same body; the extrusion root cannot be moved.
4. Show `writerOrderAfter`, `invalidation`, and each native-pending
   `status`. Update selection from the new revision, not stale drag state.
   `nativeHandoff` requests RUNTIME to evaluate but **does not certify** B-rep
   or STEP. Saved history reopens with the same semantic order.

```sh
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/valve-manifold-cut-drag.mjs
```

The real consumer example authors a six-edge stepped valve manifold with four
cut features (through slot, blind pocket, through window, blind vent) and a
separate clamp. One drag moves the slot from first to last; negative selections
must leave history unchanged; undo/redo and archive reopening reconstruct the
dependency order. A retrospective manifold extrusion-depth edit from 9→15 mm
invalidates the right cuts but not the independent 4 mm clamp.

**Qualification boundary:** This exercises real SKETCH analytic admission,
INTENT previews, RUNTIME journaling/invalidation and archive replay. It does
not execute or independently verify native Booleans, OCCT8 STEP, a graphical
drag or Firefox interaction. INTEGRATION must qualify exact-head Linux/Windows
CI, check the one-undo-frame invariant and independently review the guarded
merge; WORKBENCH owns the eventual drag UI.
