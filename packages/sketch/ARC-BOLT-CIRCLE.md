# Parametric polar bolt-circle holes (SKETCH v1)

`@intuit3d/sketch/arc-bolt-circle/v1` is an additive, revision-fenced analytic 2D hole-pattern authoring API alongside the rectangular array contract. It creates a full circular pattern by rotating the **authored source hole** about a dimensioned centre. The seed is member 0; remaining instances receive durable `patternId:i1` etc. Geometry and centre constraints are solved, not created as a visual-only overlay.

Commands: `create`, `reconfigure` (count and centre), `edit-seed` (position + diameter), `refresh` (after an external dimension edit). All return a single immutable proposal containing the solved sketch, selected profile, persistable pattern and created/removed/preserved IDs, or a non-mutating refusal. Store all three authoritative values in ONE INTENT/RUNTIME journal entry. `inspectArcBoltCircle` exposes `synchronized`, `seed_changed` and `unresolved` recovery states.

Representative 120×80 mm curved plate: three 12 mm holes on a 30 mm bolt circle with a separately authored second bore; expand to four, revise pitch centre, resize source to 10 mm, widen the plate, save/reopen, reject overlap.

```bash
node packages/sketch/examples/associative-bolt-circle.mjs
node --test packages/sketch/test/arc-bolt-circle.test.mjs
npm run typecheck --workspace @intuit3d/sketch
```

The validated line/arc/circle profile is **analytic SKETCH evidence** only (`previewOnly:true`, `nativeExact:false`, `stepQualified:false`). RUNTIME/WORKBENCH must supply an explicit body selection and journal commit; independent native B-rep and external STEP remain separate.
