# FEATUREOPS — actual cut execution-order swap v1

Export: `@intuit3d/feature-ops/ordered-cut-swap/v1`
Command: `swapOrderedBodyCuts(history, request, services)`.

**User operation:** select an explicit body and two **adjacent cuts in its dependency execution order**. Swap their actual Boolean evaluation order, retaining their original semantic IDs, source SKETCH profiles, target body and through-all/blind depths. This is not a cosmetic drag in the authored feature timeline. The accepted model's `body-cut-order` contract performs all dependency rewrites, cycle/topology checks and the single undoable transaction. When a later cut exists, its predecessor edge is repaired too.

Selection fences: explicit project/revision, `mm`/`local_xy`, body ID, both cut IDs, complete dependency writer order, both source sketch/profile/extent snapshots and 2 or 3 fresh event IDs. The API re-admits SKETCH profiles and compares RUNTIME's current analytic source before accepting INTENT's preview. A mismatch, unsupported writer, projected noncommuting reference, absent/unsolved sketch, stale selection or ambiguous body refuses without altering the caller's history.

The response provides `writerOrderBefore/After`, INTENT structural invalidation, RUNTIME transitive invalidation, current pending statuses and a revision-fenced native-provider **request**, not a B-rep. Authoring chronology is unchanged. A physical cut is still `pending_exact_provider` / `blocked_dependency` until KERNEL supports and verifies its execution.

## Run executable proof

```sh
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/manifold-cut-resequence.mjs
```

The mechanical-part consumer creates a stepped valve manifold, through-slot, finite blind pocket, downstream window and independent clamp; swaps the first two cuts, asserts the downstream dependency repair, tests invalid selections, undo/redo/archive and retrospectively changes manifold depth 9→15 mm without invalidating the clamp. No native geometry or STEP for this new manifold is executed in this fixture.

**Consumer handoff:** WORKBENCH expose two adjacent cut rows in *dependency* order (not displayed journal order), explicit current selected profiles/extent/body/revision and an intentional **Swap cut execution order** action. RUNTIME supply live status and partial rebuild; KERNEL must qualify native ordered Boolean geometry separately. INTEGRATION alone qualifies exact current main, checks the public export/type contract and performs guarded merge.