# Exact-dyadic analytic-area admission v1

**Subpath:** `@intuit3d/sketch/analytic-area/v1`. Source authority is the encoded finite IEEE-754 binary64 input. This is a bounded **analytic 2D preview** only, not a B-rep, interchange, manufacturing or decimal-exact area claim.

## Reproduced weakness

For a rectangle translated to `(1e155,1e155)` with side `(1e155+1e140)-1e155`, each naive shoelace product overflows to Infinity even though the true encoded-coordinate rectangle area is finite (approximately `1e280` mm²). The older `buildPlateProfile` rejected it with a nonfinite area although its solved coordinates and simple polygon were admissible. The new guard sums signed cross products of exact dyadic integers, eliminating overflow and cancellation in the topological area. Winding and traversal do not affect the returned area.

## Strict classification

After the shared exact polygon boundary guard, positive *net* polygon-minus-circles area is certified using `103993/33102 < π < 355/113`. The guard returns `nonpositive_net_area` when definitely nonpositive, `uncertain_net_area` when the conservative rational bounds do not certify positivity, and `unrepresentable_area` when the positive result cannot be returned as a finite positive binary64 area. No tolerance is widened or numerical invalidity hidden.

Only the **preview** area is rounded to a binary64 number, using a 100-decimal-digit approximation of π and BigInt rational rounding; a tiny circular hole can affect topology yet round out of the area scalar. This has no authority to remove that hole or export a simplified B-rep. Circle positions, perimeter contacts and hole overlap remain the distinct `circle-guard/v1` obligation; this API alone must never authorize a profile.

## Qualification and disposition

Run `npm test --workspace @intuit3d/sketch`, `npm run typecheck --workspace @intuit3d/sketch` and exact-head workspace CI. Tests include a measured old-overflow reproducer, normal two-hole dimensions, winding/cyclic invariance, JSON replay, discovery and admission, zero/nonrepresentable net area, π-bound ambiguity, invalid boundary and bounds. The implementation intentionally adds no dependencies or persistent IDs.

**Disposition:** adopt after independent Integration review and passed exact-head gates. Deferred: exact engineering area with physical tolerances, independent CAD oracles, nonlinear solver benchmark (PlaneGCS), production OCCT/STEP and human UX.
