# INTUIT3D — founding architecture

**Status: initial design contract / change through documented ADR and verified implementation.**

## Authoritative versus derived layers

**Authoritative:** project document schema, creation-order event journal, semantic object/feature IDs, sketches, dimensions, constraints, parameter expressions, semantic selections, dependency edges, intended body/feature relations and explicit failure/ambiguity state.

**Derived:** admissible feature evaluation plan, solver state/caches, OCCT B-rep, tessellation, face/edge kernel IDs, previews, selection acceleration structures and STEP files.

Never serialize a transient `TopoDS_*` or mesh triangle as the sole persistent identity.

## Diagram

```
Browser workbench (apps/web)
         |
Authoritative intent document + command journal (packages/model)
         |
Feature dependency DAG, incremental evaluation, semantic references
         |            \
Sketch solver interface  Kernel provider interface (packages/kernel-contract)
(packages/sketch)                |
                     Isolated native OCCT worker (native)
                                |
                         Validated B-rep / STEP
         |
Derived preview meshes + explicit stale/unresolved diagnostics
```

## Feature and history model

Each authored operation has: durable ID, explicit input references and expressions, authored timestamp/order, intended output roles, body selection policy, typed dependencies, independent evaluation status, diagnostics and optional last-known-valid evaluation reference.

Maintain **creation journal** separately from **dependency graph**. Check cycles, conflicting constraints, missing references, ambiguous ancestry and semantically order-sensitive operations. Topologically sort only the admissible acyclic graph; never silently reorder operations that do not commute. Preserve unsolved/pending intent and independent valid subgraphs.

Use immutable logical revisions plus transactional user commands, undo/redo and deterministic replay. Commit only authoritative state; treat all geometric caches as invalidatable. Project format must be versioned, migration-ready and robust against interrupted saves.

## Stable semantic geometry references

Persistent body/feature/role IDs are application-owned. A face/edge selection is a semantic query anchored to feature provenance, geometry type, orientation, adjacency, lineage and explicit context. Backend histories may supply evidence, but are not durable keys. Model one-to-many splits, many-to-one merges, replacements and ambiguity; never choose arbitrary enumeration order to resolve equal candidates.

## Sketch solver

Isolate a solver-agnostic constraints API: geometry primitives, constraints, solution status, residuals, DOF, conflicting constraints, drag/suggest, expression source and numerical policy. Evaluate PlaneGCS and alternatives through executable fixtures and license review. Distinguish numerical nonconvergence from contradictory and underconstrained geometry.

## Kernel and deployment

Preferred starting hypothesis: OCCT 8.0.1 behind a local process-isolated C++ worker and versioned typed provider protocol. Test native versus WASM in a bounded spike before locking deployment. Keep the renderer separate: three.js/React/TypeScript in browser, local supervision for exact geometry, non-blocking previews; provide an explicit option to run without discrete GPU.

Rationale: radiCADSAC RCS-017 observed same-process STEP-setting cross-talk and global Boolean settings; RCS-024 found newer development snapshots did not resolve all critical cases. Pin versions and qualify upgrades.

## Geometry provider envelope

Requests declare project revision and feature, intended geometry, units and coordinate frame, tolerance/uncertainty/validation policies, body selection and cancellation/deadline. Responses declare attempted backend and exact version, result status, body counts and geometric metrics, topology-history evidence, error classifications, uncertain contacts and artifacts.

Provider statuses should distinguish `validated_exact`, `pending_intent`, `ambiguous_reference`, `unsatisfied_constraints`, `numerical_failure`, `timeout`, `worker_crash`, `approximate_preview` and `requires_reconciliation`.

No approximate provider may claim engineering-grade STEP without validated analytic reconciliation.

## Tolerance and validation

Separate source/input precision, solver/numerical uncertainty, intended design dimensions/tolerances, contact classification, preview tessellation accuracy, export accuracy and geometric equivalence thresholds. Do not conflate these into one fuzzy epsilon.

Validate B-rep structural validity, analytic invariants, expected material volume/body count, selected source semantics, replay stability, STEP serialization, read-back and independent interoperability where applicable.

## Shared contracts / future ADRs

Initial shared contracts belong under `packages/kernel-contract/` or `packages/model/` with semantic versioning. Cross-lane changes require an additive, versioned proposal and an integration reconciliation step. This is an **architecture hypothesis**, not a claim that the files or implementation already exist.
