# Selected tangent round-ended edge slot — v1

Public import: `@intuit3d/sketch/selected-edge-round-slot/v1`.

This produces a **genuine semicircular-cap, tangent-wall notch opening into a chosen
straight edge of an explicitly selected, fully solved polygon profile**. It is
not the standalone closed obround loop, a faceted approximation or a native
boolean/STEP result. A slot between along-edge distances 45 and 65 mm, with
8 mm of straight wall, has radius 10 mm and an additional 10 mm of round
termination. Slot material removal is `width * straightDepth + πr²/2`.

## Authoring contract

1. Obtain a real `SelectedProfileSelection` token from
   `discoverPlateProfiles`. Inspect eligible edges using
   `inspectSelectedEdgeHolePlacement`: horizontal/vertical constrained
   edges only, inward direction determined by actual winding.
2. `createSelectedEdgeRoundSlot(sourceSketch, selection, command)` with
   `{kind:'create-selected-edge-round-slot',version:1,sourceSignature,
   id,edgeId,fromMm,toMm,straightDepthMm}` returns an immutable `authoring`
   envelope, fully solved `arcSketch`, admitted `profile`, and four
   semantic handles. The initial source is left untouched.
3. Persist `serializeSelectedEdgeRoundSlot(authoring)` verbatim with the
   authored CAD session. After reopening, call `parseSelectedEdgeRoundSlot`
   and `inspectSelectedEdgeRoundSlot` to re-solve and re-admit the analytic
   profile. No cached B-rep, samples or guessed entity IDs are persisted.
4. `editSelectedEdgeRoundSlot(authoring,{kind:'edit-selected-edge-round-slot',
   version:1,sourceSignature:authoringSignature,fromMm,toMm,
   straightDepthMm})` atomically reauthors three dimensions; no implicit
   weakening. `dragSelectedEdgeRoundSlotHandle` projects a pointer to
   `from`, `to`, `cap-tip` or rigid `slide` while reporting projection
   deviation. Sliding preserves span, radius and straight wall depth.
5. `relocateSelectedEdgeRoundSlot(authoring,{kind:'relocate-selected-edge-round-slot',
   version:1,sourceSignature:authoringSignature,edgeId,fromMm,toMm,
   straightDepthMm})` explicitly rebinds the SAME semantic slot ID to another
   eligible boundary edge, with full solver, contour and hole-clearance checks.
   Unsafe relocation refuses atomically; it never heuristically changes
   reference bindings or the original constraints.
6. `rebaseSelectedEdgeRoundSlot(authoring,newSource,newSelection,
   {kind:'rebase-selected-edge-round-slot',version:1,sourceSignature})`
   recompiles after an explicit retrospective source edit. Original edge ID
   and hole membership must persist. No automatic rebinding.
7. Commit the **whole** returned authoring envelope as one revision-fenced
   RUNTIME history event, and pass the derived analytic arc sketch/profile
   through a version-pinned consumer. WORKBENCH may expose the three handles
   with selection, rigid slide, explicit edge relocation and collision refusal messages; it must not feed the
   compiled arc sketch back to the ordinary linear-selected-profile API.

## Geometry and correctness

The authoritative source `SketchDocument` is retained in full, including
every original linear radius/equal-radius equation. The derived nonlinear
`ArcSketch` encodes circle radii as constant analytic circles, and fully
constrains five new vertices relative to the original start reference;
`arcRadius` and two real `tangent` equations bind the semicircular cap
to the sidewalls. The original edge ID is retained and shortened; an explicit
tail-axis constraint preserves the far endpoint's freedom count. Selection
is used only for the stated contour. Unselected source points are checked
for movement, and retained selected holes are independently checked for
analytic contact and clearance by the existing arc-profile guard.

Malformed/stale commands, invalid spans/depth, missing/wrong-direction
edges, semantic-ID collisions, unsupported midpoint source constraints,
under/overconstraint, nonconvergence, hole contact and boundary intersection
produce a typed refusal. The original authoring is never mutated.

No user-authored constraints are erased from the **authoritative** source.
The derived arc document is a compiled view, not an accepted replacement
for the source. Consumers must preserve both parts of that distinction.
Native 3D cuts, OCCT 8, independent STEP and actual browser gestures remain
separate downstream gates.

## Executable consumer

```sh
node packages/sketch/examples/selected-edge-round-slot.mjs
node --test packages/sketch/test/selected-edge-round-slot.test.mjs
npm run typecheck --workspace=@intuit3d/sketch
npm test --workspace=@intuit3d/sketch
```
