# ADR-0001 — Authoritative design intent and replaceable geometry backends

**Status:** Accepted founding architectural invariant; implementation details remain revisable.

## Decision

Persist the semantic design document, parameters, constraints, stable feature/body identities, authored event order, dependency graph and explicit pending/error/ambiguity state as authority. Geometry-kernel B-reps, topological IDs, meshes, STEP export and cached evaluation order are derived.

Do not enforce that authored chronological order is identical to evaluation order; resolve a dependency-safe plan, retain order-sensitive restrictions and surface impossible/ambiguous relationships. A failed operation remains editable with its failure diagnostics; last validated geometry remains explicitly marked stale.

## Why

The defining INTUIT3D value proposition is a forgiving parametric workflow under retrospectively added design intent and unconventional operation order. OCCT geometry histories and face numbers cannot alone preserve that meaning. radiCADSAC measured divergent topology identities under equivalent reconstruction and numerical-valid-but-physically-wrong operations.

## Consequences

The initial document schema and provider boundary are critical-path milestones. All lanes must avoid leaking transient OCCT or renderer objects into durable project identity. The kernel choice stays an implementation decision based on executable compatibility evidence.

See docs/ARCHITECTURE.md, docs/ACCEPTANCE.md and docs/RESEARCH-INTAKE.md.
