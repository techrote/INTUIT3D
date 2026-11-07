# Signed dimensional fidelity guard v1

**Import:** `@intuit3d/sketch/dimension-fidelity/v1`.

The linear v1 solver previously used a provisional absolute residual bound of
`1e-9 mm`. For nonzero signed X/Y dimensions much smaller than this bound,
or for small dimensions at a large coordinate origin, a binary64 solve could
return unchanged endpoints and still report `solved` or `underconstrained`.
That is a loss of authored dimensional intent, not an acceptable tolerance
adjustment.

`assessSignedDistanceFidelity(sketch, geometry)` audits each nonzero signed
distance and each explicitly fixed coordinate using **exact dyadic integer arithmetic on encoded binary64 inputs and
outputs**. The difference between two coordinates must agree with the encoded
authored dimension to relative error no greater than `2^-40`. The calculation
never squares enormous coordinates, underflows a microscopic delta, enlarges
the solver's physical residual tolerance or moves the requested geometry.

The solver now returns `numerical_failure`, null geometry, and a
`dimension_precision_lost` diagnostic containing authored constraint IDs
when this check fails. This also covers underconstrained previews and
transient drag proposals. Source documents remain unchanged and repairable;
serialization/replay preserves the refused intent. The separate helper is a
**diagnostic**, not an admission authority for externally supplied geometry.

**Limits:** The threshold is a conservative binary64 fidelity diagnostic,
not a manufacturing or engineering tolerance, general nonlinear accuracy
guarantee, exact geometry or OCCT/STEP proof. Zero-valued *distance* constraints retain the old absolute residual policy;
fixed zero-valued coordinates must remain exactly zero. Horizontal,
coincident, equal-radius and radius constraints are not covered by this
v1 additional guard. These require
separate qualification before claiming fully reliable sketch numerical truth.

Run `node --test test/dimension-fidelity.test.mjs`, `npm test`, and
`npm run typecheck` from `packages/sketch` on Node 22+. Tests include
large-origin small positive/negative dimensions, microscopic *representable*
dimensions, ordinary decimal dimensions, residual-hidden contradictions,
authored edit/replay, and a tampered-preview rejection.
