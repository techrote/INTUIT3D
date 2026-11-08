# Interior Machining Recipe Insertion — version 1

**FEATUREOPS scope:** `packages/feature-ops/**` only. This is a new
consumer workflow for inserting 2–8 selected source machining cuts **between
existing cuts of another body**, rather than merely appending them. It composes
the accepted recipe copy admission and accepted INTENT physical cut-block
relocation; no independent geometry kernel, dependency solver or journal
writer is created.

## Consumer API

Import from `@intuit3d/feature-ops/interior-recipe-insert/v1`:

- `inspectInteriorRecipeInsertion(history, selection, services)`
- `applyInteriorRecipeInsertion(history, request, services)`

`services` combines the accepted `CutRecipeCopyServices` and
`CutBlockPlacementServices` (MODEL, RUNTIME, SKETCH profile discovery,
INTENT cut chain, INTENT block relocation). The caller must supply an
immutable RUNTIME history and real accepted services, not substitute mock
geometry or browser-local state.

**Gesture:** select a contiguous source relief/bore or bore/counterbore
block, select a *different* existing machined body with at least two cuts,
allocate 2–8 stable new cut IDs and 2–8 copy event IDs, then inspect. The
inspector stages the copy **only in disposable immutable histories** and
returns the real currently admitted target writer order and paged (maximum
16) INTENT-tested insertion destinations. Each available destination
supplies its exact required 2–3 move-event count. The UI displays the
source sketches, blind/through extents, cut IDs and blocked-anchor
diagnostics; it must not silently choose an anchor.

Call `applyInteriorRecipeInsertion` with the same selection and:

```js
{
  expectedSourceCuts: inspection.sourceCuts,
  expectedTargetWriterOrder: inspection.targetWriterOrder,
  insertAfterBodyWriterId: selectedAvailableDestination.afterBodyWriterId,
  moveEventIds: freshlyAllocatedIdsForRequiredEventCount
}
```

The API demands explicit `mm`/`local_xy`, project ID, revision and a
canonical serialized-document fence. Source selection, target writer order,
new IDs and admission are rechecked against the current history. All
copy and move events are staged in disposable RUNTIME histories, compared
against the canonical source journal, and committed to the actual
history in **one** RUNTIME `commit` / **one** undo frame. If the later
dependency move is invalid, the prior copy does not persist.

The result returns new stable cut identities, the before/after target
execution orders, the exact event IDs, INTENT-rewired writer IDs, affected
body IDs, RUNTIME invalidation and provider-pending feature statuses.
Consumers replace the authoritative RUNTIME history once and use
`sourceRevision` for a future, separately qualified native evaluation.
This is not a claim that any profile physically intersects the destination.

## Runnable example / qualification

```sh
node --experimental-strip-types packages/feature-ops/examples/interior-recipe-insert.mjs
node --experimental-strip-types --test packages/feature-ops/test/interior-recipe-insert.integration.test.mjs
npm test --workspace @intuit3d/feature-ops
npm run check:workspace
```

The example builds a real L-shaped machine guard (blind relief, through
bore, later finishing groove), backing rail (pilot channel and finishing
groove), and independent shim. The command inserts a copied relief/bore
pair **after the rail pilot but before the rail's finishing cut**. It
checks 19 negative/adversarial requests, unchanged source cuts and later
source finishing groove, target-dependent rebuild, unaffected shim,
retrospective edit, undo/redo, archive save/reopen and shared SKETCH
invalidation. Root workspace and hosted Ubuntu/Windows CI remain
INTEGRATION-owned; source-matched results must be recorded before admission.

## Provider and product boundary

MODEL/SKETCH/RUNTIME semantic and analytic evaluation is demonstrable by
the executable fixture. `pending_exact_provider` and
`blocked_dependency` remain genuine states; this operation does **not**
run or certify pinned OCCT8 native Booleans, independent STEP readback,
Windows browser use or physical assembly mating. Product #74 remains
an independent INTEGRATION acceptance gate. No geometrical validity
is inferred from a successful dependency reorder alone.
