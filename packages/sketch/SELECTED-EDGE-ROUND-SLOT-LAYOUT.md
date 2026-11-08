# Multiple selected-contour tangent slots — layout v1

Public API: @intuit3d/sketch/selected-edge-round-slot-layout/v1.

This is an additive versioned authoring contract built on accepted single-slot
selected-edge-round-slot/v1. A single source-constrained selected contour can
carry 1–8 independently editable semicircular tangent cutouts, including two or
more cutouts along the same edge and slots on different eligible axis-aligned
edges. Original linear sketch intent and all its authored constraints remain
unchanged in the persisted envelope.

## Contract and commands

- createSelectedEdgeRoundSlotLayout(source,selection,
  {kind:'create-selected-edge-round-slot-layout',version:1,sourceSignature,slots})
  admits one atomic initial batch. Each slot is
  {id,edgeId,fromMm,toMm,straightDepthMm}.
- inspectSelectedEdgeRoundSlotLayout returns fully solved analytic arcSketch,
  profile, boundary IDs, source and envelope signatures, per-slot semantic edge
  bindings and four semantic handles per slot (from/to/cap-tip/slide).
- addSelectedEdgeRoundSlotLayout, editSelectedEdgeRoundSlotLayout,
  relocateSelectedEdgeRoundSlotLayout and removeSelectedEdgeRoundSlotLayout
  are revision-fenced atomic mutations. Relocation is explicit; a dimension
  edit never silently rebinds an edge. Removing the last slot is refused:
  deleting the entire feature is a distinct RUNTIME journal operation.
- dragSelectedEdgeRoundSlotLayoutHandle uses the accepted single-slot
  projection equations but admits the resulting multi-slot contour in full.
  It reports the requested and applied coordinates plus deviation.
- serializeSelectedEdgeRoundSlotLayout / parseSelectedEdgeRoundSlotLayout
  persist only source, selected-contour token and authored slot dimensions.
  The nonlinear sketch and physical output are derived on reopen.
- rebaseSelectedEdgeRoundSlotLayout requires a caller-supplied new authoritative
  source and selected-contour token. Every slot must independently retain its
  original semantic profile, edge endpoint IDs and hole membership.

## Exact geometric scope and refusals

All original selected boundary edges keep their IDs. Each trimmed boundary
edge becomes ordered shortened edge / wall / true tangent semicircle / wall /
tail segments, repeated for each slot. Slots on the same edge are sorted by
along-edge distance for topological ordering, while persisted authoring order
and semantic slot IDs are never rewritten. Non-touching mouth intervals are
required; the combined nonlinear solver must be fully constrained at zero DOF.
The existing global analytic-arc admission guard verifies that the composed
boundary is a closed non-self-intersecting wire with all original holes safely
contained and non-contacting. A permitted per-slot shape does NOT imply that
two slots are mutually permitted.

Errors are explicit typed refusals, including slotId when attributable:
stale source, invalid selection, duplicate IDs, overlap/touching mouths,
unsolved or contradictory source, nonlinear rank/geometry failures, global
boundary/hole contact, and unsafe retrospective edits. Neither the original
sketch nor the supplied envelope is ever mutated on failure.

This is **analytic 2D only**. nativeExact=false; no OCCT B-rep,
physical cuts, independent STEP import, runtime journaling or browser pointer
acceptance is claimed. RUNTIME must persist the complete authoring envelope
in one revision-fenced event (not a compiled arcSketch). WORKBENCH should
render per-slot handles from the inspection, relay sourceSignature, and expose
refusal reason/slotId/diagnostics without silent healing. INTEGRATION owns
cross-package adoption and guarded merge.

## Executable cases

node packages/sketch/examples/selected-edge-round-slot-layout.mjs
node --test packages/sketch/test/selected-edge-round-slot-layout.test.mjs
npm run typecheck --workspace=@intuit3d/sketch
npm test --workspace=@intuit3d/sketch
