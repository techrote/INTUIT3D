# Circular bolt-circle authoring v1

The versioned `@intuit3d/feature-ops/circular-bolt-pattern/v1` exposes
`authorCircularBoltPattern(history,request,{runtime,model})`.

It targets an explicitly selected solved circle on a known cut-bearing
sketch/extrusion/body, checked against a project and revision fence.
RUNTIME's accepted `patternCircularHoles` command computes the signed
angular sweep (2–32 instances, including the retained original), gets
**actual solved SKETCH coordinates**, validates the resulting sketch and
records one undoable INTENT transaction. Copied holes use stable IDs
`<idPrefix>:p1`, `<idPrefix>:p2` and so on.

No new solver, geometry kernel, journal, contact predicate or native
exporter is introduced. This is a **one-shot** set of independently
editable sketch holes, not an associative native pattern. The pending cut
remains `pending_exact_provider`; no production OCCT8 B-rep, native STEP
or independent interchange is claimed.

Run:
```sh
npm ci
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/bolt-circle-l-bracket.mjs
```

The actual consumer authors a six-sided L bracket with six-hole bolt ring,
plus an independent spacer, changes bracket thickness from 8 to 12 mm,
checks dependency invalidation, undo/redo and archive reopening.

**WORKBENCH:** supply source circle, pivot, sweep, count, output ID prefix,
explicit body/cut/extrusion and revision. **RUNTIME/KERNEL:** qualify the
generic physical cuts separately. **INTEGRATION:** independent source and
exact-head checks followed by guarded merge; no changes requested to shared
root/CI in this PR.

## Retrospective pitch-circle and bore edit

`resizeCircularBoltPattern(history, request, {runtime, model, sketch})` is an
additional `circular-bolt-pattern/v1` public operation. It requires the original
`sourceHoleId`, `idPrefix`, `instances`, signed `sweepDegrees` and explicit pivot
used to create the circle, plus positive dimensionless `pitchCircleScale`
and `boreRadiusScale`. `units:'mm'`, `frame:'local_xy'`, project ID, revision
and selected sketch, extrusion, cut and body are mandatory.

The original source and all named copies are resized **together**, including
their radii, by accepted RUNTIME `resizePlateHoleLayout` in one journal event.
All coordinates and radii are read from an actual SKETCH solution.
The operation refuses absent copies, mismatched solved angular provenance
(fixed 0.000001 mm diagnostic comparison), other body writers, unsolved
sketches, stale revisions and no-op or invalid dimensions. It does not
silently reconstruct a pattern after individual manual hole edits. SKETCH
profile admission can return `kind:'refused'` with an uncommitted history;
physical Boolean execution remains `pending_exact_provider`.

Runnable full consumer:

`node --experimental-strip-types packages/feature-ops/examples/bolt-circle-retrofit.mjs`

Creates an L-bracket with six holes and a separate spacer, resizes bolt
pitch-circle radius **15 → 18 mm** and hole radius **4 → 3 mm**, performs
resize undo/redo and an early 8 → 12 mm extrusion edit, saves/reopens, then
checks solved hole positions/radii and unchanged independent spacer.
The fixture demonstrates semantic authoring and replay, **not** native B-rep
or independent STEP interoperability. WORKBENCH supplies selection and
fields; RUNTIME/SKETCH remain the commit and solver authorities.
