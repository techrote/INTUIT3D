# @intuit3d/sketch — bounded linear sketch provider v1

**Status:** executable, dependency-free linear constraint prototype. **Not** PlaneGCS, a general nonlinear sketch solver, exact predicates, B-rep, STEP, or verified CAD geometry. This is a reversible solver adapter for early INTUIT3D integration.

## Contract

The package exports `createSketch`, `validateSketch`, `serializeSketch`, `parseSketch`, `editConstraint`, `solveSketch`, `suggestDrag`, `buildPlateProfile`, and `plateSketchFixture`, with ESM runtime and TypeScript declaration at `index.d.mts`. The v1 document has millimetre-only units, stable app-owned IDs, authored point/line/circle lists, and explicit constraints. Unknown fields or invalid references are rejected so incidental renderer/kernel state cannot enter persisted sketch intent.

The algebraic solver supports fixed point, horizontal/vertical line, coincident points, signed X/Y separation, radius and equal-radius constraints. It uses deterministic Gauss–Jordan elimination to report rank, degrees of freedom, redundant equations, contradictory constraints and nonpositive circles. A consistent rank-complete result is `solved`; free parameters are `underconstrained` with seed-based **preview** coordinates; inconsistent or overflowing arithmetic returns **no geometry**. Status `solved` says the supported scalar equations are admissible, **not** that the resulting curves are an exact manufacturable profile.

Numerical policy: coefficient pivot bound `1e-12` (for this limited coefficient family), physical residual `1e-9 mm`. Callers may only request stricter policy, never silently enlarge thresholds. These are provisional bounds; no production conditioning or adaptive predicates qualification has been performed.

`editConstraint(document, id, {value})` preserves authored IDs/order and does not mutate input. Fixed-point constraints can edit `x` or `y`. `suggestDrag(document, pointId, {x,y})` evaluates a temporary fixed-point proposal without persisting a constraint, returns a stamped **preview-only** result, and refuses to override a contradictory dimension or lock. Sketch save/load uses versioned JSON and reruns constraints rather than serializing solver-owned geometry.

`buildPlateProfile(sketch,solution,edgeIds,holeIds)` requires a **fully constrained, matching** input solution and an explicitly ordered directed simple polygon cycle with optional strictly interior, non-tangent, nonoverlapping circular holes. It returns an `analytic_profile_only` area (mm²), **not** exact solid geometry. It refuses wrong-stamp, self-intersecting, nonclosed and overlapping profiles. The floating-point segment tests are unsuitable for claiming correctness around near-tangency/slivers and extreme scales without robust geometric predicates.

## First fixture

The 120 × 80 mm rectangle and two radius-6 mm holes are individually constrained. Every entity and constraint retains a semantic ID across width changes and JSON save/reopen. The plate sketch predicts an area of `9600 - 72*pi` mm²; thickness and volume belong to a separate KERNEL/INTEGRATION analytic oracle.

## Executed developer commands

From `packages/sketch` on Node.js 22+:

```sh
npm test
tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 test/type-contract.mts
```

The first command executes 28 deterministic/adversarial Node tests (including transient drag and a 36-case dimension grid): fully constrained plate, dimension update, ID-preserving serialization/replay, underconstraint, contradiction, duplicate/redundant constraints, missing references, unsupported nonlinear operations, invalid numeric values, free seed behaviour, cycle validation, hole intersection/boundary refusal, equal radius, coincidence, stale results, explicit numeric policy, self-intersection, schema closure, arithmetic overflow, inherited-property rejection, fabricated-solution refusal and nonfinite profile-area refusal. Typecheck uses TypeScript 5.8.3 in the development environment; no workspace lockfile or shared dependency has been changed here. Root CI/workspace integration is owned by INTEGRATION and must be rerun at the exact admitted PR head.

## PlaneGCS evaluation (research intake)

The next nonlinear candidate is `@salusoft89/planegcs` (current published release 1.3.0 as of 2026-11-06), a WebAssembly wrapper around FreeCAD's PlaneGCS. The npm listing identifies license `LGPL-2.0-or-later`, which requires a distribution/legal review and preservation of applicable license and source availability obligations before bundling. Its documented capabilities include circles, arcs, splines, tangency and nonlinear numeric optimization.

References: https://www.npmjs.com/package/@salusoft89/planegcs and https://github.com/Salusoft89/planegcs and https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Sketcher/App/planegcs .

**Disposition:** **ADOPT** this small, dependency-free linear baseline for early prototype/interop tests only; **DEFER** PlaneGCS integration until a pinned browser/Node build, measured determinism/DOF/contradiction fixtures, profiling and license plan exist. No PlaneGCS WASM binary or source was downloaded, built or executed during this implementation.

## Not yet supported

Nonlinear Euclidean dimensions, angles, tangencies, arcs/splines, robust orientation, automatic profile extraction, drag nullspace projection (only temporary fixed-point drag is supported), large/skew conditioning, exact topology references, cross-provider equivalence, independent graphical acceptance and production export. Consumers should treat all proposed extrudes/cuts as pending actual OCCT/STEP qualification; do not substitute the analytic profile area for a validated B-rep.

**Ownership:** all files live under `packages/sketch/**`; coordination of root workspaces/CI and cross-package admission is assigned to INTEGRATION.

## Bounded minimal conflict witness

The additive `@intuit3d/sketch/conflict-explanation/v1` interface reports one independently rechecked irreducible authored-constraint conflict for the current linear solver, or explicit numerical/budget/unverified refusal. It does not change sketch intent or claim exact nonlinear constraint proof. See [CONFLICT-EXPLANATION.md](CONFLICT-EXPLANATION.md) and the executable adversarial tests.


## Deterministic line-loop profile discovery v1 (additive)

The versioned \`@intuit3d/sketch/profile-discovery/v1\` subpath supplies
\`discoverPlateProfiles(document, options?)\` and
\`admitDiscoveredPlateProfile(document, proposal, candidateId)\`. Discovery
recognizes unordered / reversed authored line segments by **semantic endpoint
IDs**, constructs a canonical directed traversal without mutating the source,
and identifies strictly enclosed circular holes. It reruns the existing
fully-constrained linear solver and \`buildPlateProfile\` analytic validator
on derived oriented segments. Changing dimensions preserves candidate identity
while changing analytic area. The result is \`previewOnly: true\`, stamped
with the serialized authoritative sketch; admission independently replays
the full proposal and refuses stale, forged or ambiguous proposals.

**Safety boundary:** Open chains, T-junctions, self-crossings, contacting
circles, overlapping holes, unsolved constraints and resource limits are
explicit rejections. Two disconnected or nested cycles are **ambiguous**, not
automatically combined or classified as Boolean topology; admission requires
a single unambiguous supported candidate. Visually coincident but differently
identified points are never welded by guesswork. The v1 analytic profile
is *not* an exact-predicate geometric model, a manufacturable B-rep, a STEP
artifact, or permission to infer body selection. Segment/circle contact tests
use floating point and are not an independent near-tangency oracle.
Separate rigorous predicates and nested-loop topology contracts remain
future work.

Tests: \`node --test test/profile-discovery.test.mjs\`; and
\`npm run typecheck\` from this package, which now includes the typed
consumer. No new dependency or shared lockfile modification is required.
