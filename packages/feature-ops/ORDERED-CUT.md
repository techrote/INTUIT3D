# FEATUREOPS ordered-cut/v1: multiple cuts on one named body

`appendOrderedProfileCut(history, request, {runtime,model,sketch,discovery,cutChain})`
adds a second (or later) explicitly ordered cut to a uniquely selected semantic
body. It consumes the accepted INTENT `@intuit3d/model/body-cut-chain`
terminal inspection/preview, real SKETCH profile discovery/admission and the
one-transaction RUNTIME commit. It never infers a body from timeline order or
fabricates a Boolean, B-rep, or STEP file.

The caller provides `format:'intuit3d.feature-ops.ordered-cut'`, `version:1`,
`expectedProjectId`, `expectedRevision`, a unique `eventId`, `units:'mm'`,
`frame:'local_xy'`, `sourceSketchId`, the current `cycle:` profile ID,
`afterBodyWriterId`, `targetBodyId`, `cutFeatureId`, and an explicit
`extent:{kind:'through_all'}` or `{kind:'blind',depthMm:3}`.

If the preceding writer is an extrusion, the added cut remains
`pending_exact_provider`. If it is an earlier pending/blocked cut, the next
cut currently has RUNTIME status `blocked_dependency` while INTENT reports
`semanticStatus:'ready'`. This is intentional and **not** a finished native
pocket. No attempt is made to treat an analytic 2D outline as a physical cut.

## Runnable consumer

From the admitted INTUIT3D root on Node 22+:

```sh
npm ci
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/ordered-pocket-bracket.mjs
```

The consumer authors a six-sided L-bracket, an independent spacer, a first
through-cut and an explicitly ordered 3 mm blind pocket; retrospects the
bracket thickness from 8 to 12 mm; verifies only that body chain invalidates;
and archives/reopens with stable semantic IDs. It rejects obsolete sketch
candidate, stale project/revision, wrong or unordered terminal, ambiguous body
selection and invalid extent before commit. Source editing/undo use accepted
model/RUNTIME history, not a private FEATUREOPS journal.

## Consumer handoff

- **WORKBENCH:** expose target body, unique terminal writer, selected SKETCH
  profile, `through_all` or positive blind-depth control. Show both semantic
  and runtime state; `blocked_dependency` is **not** a physical pocket.
- **RUNTIME:** no contract mutation required. Existing pending predecessor
  correctly blocks dependent exact evaluation. A future native provider must
  produce independently validated exact geometry before claiming success.
- **KERNEL:** a dependency-ordered list of cuts targeting one body and their
  declared extents remains a future provider requirement, not an executed STEP.
- **INTEGRATION:** only this package's manifest exports require registration;
  requalify the current exact head on Ubuntu/Windows and guard any merge.
