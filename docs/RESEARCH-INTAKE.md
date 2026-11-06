# INTUIT3D — continuous research and prototype intake

## Mission

Turn the latest relevant research into measured engineering outcomes **within the same ongoing product programme**. Avoid both speculative architecture lock-in and indefinitely parked prototypes.

## Expected tangible output

Every substantial tangent has: issue or PR, owning lane, falsifiable hypothesis, exact baseline/commit/dependency pin, executable reproducer or user workflow, observed success/failure, generalization limits, chosen disposition and integration dependency.

Disposition is one of:
- **Adopt now:** qualified implementation fits a stable contract; integrate promptly.
- **Repair then adopt:** promising measured improvement with a bounded remaining blocker; retain an owner.
- **Reject:** negative evidence makes the path inferior or unsafe; preserve failure fixture if useful.
- **Defer:** genuine promising work is dependency-blocked or too costly now; record a trigger for revisit.

Exploration may be ambitious, including alternate constraint solvers, topology remapping, native/WASM kernels, exact predicates, deferred topology and UX prototypes. New architectural dependencies remain reversible until justified by executed evidence.

## radiCADSAC transfer list

- RCS-008: kernel-independent semantic lineage, split/merge ambiguity, stable body/operation identity.
- RCS-007: separate tolerance policy channels and prohibit global fuzzy tolerance from erasing intended geometry.
- RCS-009: bounded deferred topology with explicit reconciliation, rather than treating all approximate geometry as exact.
- RCS-017: process isolation for OCCT global config and STEP serialization tests.
- RCS-024: pinned exact OCCT version differential; don't upgrade because development branch has a higher version.
- RCS-005: multi-layer STEP contract (source state, serialization, read-back, independent interoperability).
- RCS-013: geometry-provider hybrid and programme-owned authoritative semantics rather than wholesale OCCT fork.

Sources: https://github.com/techrote/radiCADSAC . Note the original evidence concerns manufacturing material-removal cases, not a proof of general constructive CAD semantics. Build additional CAD-specific oracles.

## Acceptance criteria for tangent promotion

- Does it solve a measured INTUIT3D limitation or unlock a visible user workflow?
- Is it compatible with the intent model and stable IDs?
- Does it keep exact vs preview state explicit?
- Has it been tested against existing adversarial cases and performance costs?
- Does it avoid dependency/version/license hazards?
- Can it be integrated with non-overlapping writes and rollback?

INTEGRATION should routinely scan research PRs and route qualified work into main, not wait for an arbitrary research phase to end. Each lane may research and incorporate compatible experiments within its own ownership.
