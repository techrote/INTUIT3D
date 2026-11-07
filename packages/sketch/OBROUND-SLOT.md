# Obround/slot analytic profile v1 — executable SKETCH contract

`@intuit3d/sketch/obround-slot/v1` creates and edits an authentic **solved, two-line/two-semicircle sketch** with authored tangent, equal-radius, horizontal, centre-span and diameter constraints. It is not a mesh construction. The closed analytic wire is checked by `arc-profile/v1`, and curve IDs survive length, diameter, translation and save/reopen. Typical use: an elongated mounting slot that a target-body cut feature may consume.

```sh
node packages/sketch/examples/obround-slot.mjs
node --test packages/sketch/test/obround-slot.test.mjs
npm run typecheck --workspace @intuit3d/sketch
```

Public methods: `createObroundSlot({id, overallLengthMm, diameterMm, originXmm?, originYmm?})`, `inspectObroundSlot(doc,id)`, `editObroundSlot(doc,id, {kind:'resize', overallLengthMm,diameterMm} | {kind:'move',originXmm,originYmm}, expectedSignature)`. A successful edit is **one immutable, revision-fenced proposal**, ready for an INTENT/RUNTIME journal transaction; SKETCH never mutates a document or owns undo. The v1 adapter deliberately declines to rewrite an independently modified slot sketch; direct arc constraint edits remain available through `arc-constraints/v1`.

The boundary order is lower edge, right semicircular cap, upper edge, left semicircular cap. All coordinates in millimetres; `overallLengthMm > diameterMm > 0`. Material area must match `(L-D)*D + pi*(D/2)^2` mm². No arbitrary coordinate quantization, tolerance widening or automatic repairs.

**Truthful evidence status:** `providerSubmissionReady` means analytic profile data can be passed to a geometry provider for verification. `nativeProfileAdmissible:false`, `exactBrepAvailable:false`, `stepQualified:false` remain false until the native worker actually executes. The bounded nonlinear solver and analytic intersection checks are not independent exact predicates. Browser controls, OCCT 8.0.1, actual body cutting and independent STEP import are outside this SKETCH-only PR.

Consumers in FEATUREOPS/RUNTIME/WORKBENCH can import the typed subpath and commit accepted source/selection as one event; explicit body selection and physical B-rep operations stay with their respective owners.
