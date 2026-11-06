# Circular profile admission — exact dyadic predicates v1

**Public subpath:** `@intuit3d/sketch/circle-guard/v1`

This additive contract checks one simple polygon and up to 64 circles. It is
used by both `buildPlateProfile` (all explicitly selected holes must lie
strictly within the loop) and `discoverPlateProfiles` (only strictly enclosed
circles are inferred; exterior circles are not treated as holes).

## Reproduced defect and repair

An edge from `(0,0)` to `(1e-170,1e-170)` has nonzero encoded endpoints,
but `dx*dx+dy*dy` is **zero** in IEEE-754 binary64. A circle with centre at
`(5e-171,5e-171)` and radius `1e-171` touches that edge. Previous floating
projection computed `0/0` and failed to detect the contact while the complete
polygon still had a normal 100 mm² area. The former ray cast also classified
the centre as inside. This was reproduced with Node.js 22.16 on 2026-11-06.

The guard now converts every finite binary64 coordinate to the **exact dyadic
value that was actually encoded**. Segment projections use integer dot
products, interior distances use squared cross products, point-in-polygon
uses signed integer orientations, and circle overlap uses exact squared
integer distances. It checks the shared polygon simplicity guard before any
circle classification. No floating epsilon, square root, division, snapping,
or tolerance expansion participates in these topological decisions.

The result is `verified` with `insideIds` / `outsideIds` or `rejected`
with a specific diagnostic. On a rejected crossing, `outsideIds` can still
identify the offending circle's centre as strictly outside for compatible
consumer diagnostics. Centres lying exactly on a boundary are reported as
contact, not silently classified as exterior.

## Scope and trust

* The predicates prove 2D relationships **only for finite encoded binary64
  coordinates**. They do not recover decimal literals that rounded on input,
  or account for real-world measurement/tolerance uncertainty.
* No new exact-area calculation is provided: `areaMm2` remains a floating
  analytic preview and may lose microscopic areas. No STEP, OCCT, persistent
  face ID, native geometry, PlaneGCS or independent CAD interoperability
  claim follows from this guard.
* Maximum 256 polygon vertices and 64 circles per call. A malformed,
  self-intersecting, zero-area or over-budget input fails closed. Inputs are
  not modified. Rejected sketches retain all authored constraints and IDs.
* Whole-polygon testing is intentionally not a cheap mousemove predicate.
  In a local Node.js 22.16 run (software CPU, `performance.now()`, warm
  sequential iterations, no parallel requests), the isolated reference
  prototype measured ~0.028 ms/call for a 4-edge/two-hole plate over 1000
  runs and ~30.745 ms/call for 256 polygon vertices/64 exterior circles over
  30 runs. These are development-machine measurements, not product latency
  guarantees or matched CI-host benchmarks.

## Qualification

Run from `packages/sketch`:

```sh
npm test
npm run typecheck
```

The regression fixture covers the known false admission, nearby genuinely
valid microgeometry, ordinary contacts/overlaps, extreme finite exponents,
winding/cycle invariance, save/reopen, and the source profile discovery/
admission path. Integration must independently review and execute exact-head
cross-platform CI before merging. **Disposition: adopt after qualification;
retain exact geometry, numerical area and tolerance validation as separate
contracts.**
