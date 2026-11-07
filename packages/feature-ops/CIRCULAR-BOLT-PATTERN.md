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
