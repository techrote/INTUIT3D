# Independently editable analytic rounded corners — v2

Run the real authored fixture using:

```sh
node packages/sketch/examples/variable-corner-fillets.mjs
npm test --workspace @intuit3d/sketch
npm run typecheck --workspace @intuit3d/sketch
```

Import `@intuit3d/sketch/rounded-plate/v2`. The new versioned
`VariableRoundedPlateIntent` binds **four separate positive radius dimensions**
to the original rectangle vertex IDs (e.g. `p0` through `p3`). Unlike v1's
global radius, a corner handle changes only its own radius; other corners and
hole IDs do not move unless a real sketch dimension is explicitly edited.

`solveVariableRoundedPlate(sketch, intent)` independently reruns the existing
authoritative linear sketch equations and circular-hole profile admission.
It constructs four analytic quarter-circle arcs tangent to adjacent trimmed
straight segments, checks **the sum of radii at each edge**, preserves arc and
line IDs, verifies circular-hole clearance and computes analytical area.
`inspectVariableRoundedPlateHandles` and `dragVariableRoundedPlateCorner`
support signed pointer projection and stale document/intent signatures.
Unsatisfied constraints, intersecting fillets, hole intrusions and bad references
retain authored intent but return no geometry. JSON replay re-solves everything.

**Qualification boundary:** deterministic, bounded constructive tangency, not
a general nonlinear constraint solver, PlaneGCS execution, exact OCCT wire,
B-rep, STEP or browser graphical interaction. All geometries return
`previewOnly: true`. Existing v1 saved intent/API is unchanged. Consumers
must not substitute analytic area or curves for native exact provider evidence.

This implementation advances #63 with a real independently editable radius
workflow. General nonlinear constraints, native curved-wire admission and
actual browser pointer consumption remain follow-up acceptance work.
