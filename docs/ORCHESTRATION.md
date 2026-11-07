# INTUIT3D — ten owner-approved permanent scheduled workers

## Core policy

**Ten fixed recurring workers, one per lane, with owner-approved additions [#49](https://github.com/techrote/INTUIT3D/issues/49), [#80](https://github.com/techrote/INTUIT3D/issues/80), [#81](https://github.com/techrote/INTUIT3D/issues/81), [#134](https://github.com/techrote/INTUIT3D/issues/134) and [#135](https://github.com/techrote/INTUIT3D/issues/135).** All are broad enough to sustain development for months but have unambiguous primary write ownership. Workers start on their fixed hourly schedule, fresh-audit GitHub, select work within scope, implement, validate and leave GitHub handoffs. **No central planner, no spawning scheduled successors, no Scheduswarm dispatcher queue, no chained tasks.**

Suggested stagger: INTENT at :00, SKETCH at :12, KERNEL at :24, WORKBENCH at :36, INTEGRATION at :48 (Europe/London); owner-approved RUNTIME at :54 UTC (#49), FEATUREOPS at :06 Europe/London (#80), PLATFORM at :42 Europe/London (#81). Actual runs may overlap; schedule staggering is a courtesy, not a transaction lock.

## Lane map

| Lane | Primary write authority | Sustained responsibilities | Required integration touch |
|---|---|---|---|
| INTENT | `packages/model/**` | Durable project schema, semantic document, intent command journal, dependency graph, partial rebuild, persistent references, repair/ambiguity state | Versioned model contract and tests consumable by web/kernel |
| SKETCH | `packages/sketch/**` | Sketch geometry, solver benchmarking/adapters, constraint diagnostics, profiles, projection, snaps, numerical correctness | Typed sketch commands, example fixtures and UX consumption notes |
| KERNEL | `native/**`, `packages/kernel-contract/**` | OCCT bootstrap, native/WASM experiments, isolated worker, exact geometry, STEP, validation, numerical/Boolean robustness | Versioned provider API, fixtures and export evidence |
| WORKBENCH | `apps/web/**` | Local 3D workbench, viewport, precision interaction, Fusion-inspired layout, timeline/graph, inspector, keyboard, usability | End-to-end user workflow referencing versioned model/kernel contracts |
| RUNTIME | `packages/workflow-runtime/**` | Application command/evaluation bridge consuming versioned model, sketch and kernel interfaces; truthful pending/stale/preview/exact statuses without duplicating domain engines | Public workflow runtime contract and executable integrations, no root/CI writes |
| FEATUREOPS | `packages/feature-ops/**` | Parametric feature operations over accepted INTENT/SKETCH/RUNTIME/KERNEL without duplicating domain authority | Runnable new mechanical part, typed consumer and native handoff, #80 |
| PLATFORM | `platform/native-toolchain/**`, `conformance/external-cad/**` | Pinned OCCT C++ build/provisioning and non-OCCT external CAD STEP conformance | Real C++/STEP artifacts, portable toolchain and independent geometric readback, #81 |
| ENGINEERING | `packages/engineering/**` | Derived sketch/document measurements, dimensioned A3 SVG, source/revision provenance; no native mass claims | Accepted SKETCH/INTENT document and exact-head drawing tests; #135 |
| INTERCHANGE | `packages/interchange/**` | Bounded units-preserving DXF sketch import/export with analytic arcs and circles; no duplicate solver | Accepted SKETCH round-trip and CLI evidence; #134 |
| INTEGRATION | `package.json`, workspace/lockfiles, `.github/**`, docs shared statuses and `docs/OWNER-STEERING.md`, cross-package wiring, CI/release | Exact-head qualification, reconcile and merge safe PRs, keep main runnable, ingest mature research prototypes, **receive owner guidance, maintain evidence-based programme assessment and publish durable steering decisions** | Publish accepted source SHA, conformance evidence, demo, unresolved risks and owner-steering decisions |

Additional source trees may be created through PR discussion; write ownership must remain explicit. INTEGRATION does not own other lanes' feature development and must not become a central planner.

## Owner steering and assessment

**Owner-to-project interface:** the owner may discuss product direction, priorities, architectural trade-offs or current-state assessment with Integration & QA. That worker maintains [docs/OWNER-STEERING.md](OWNER-STEERING.md) as a shared, explicit steering record and opens/updates targeted GitHub issues or ADRs for independently actionable decisions. Every worker reads the shared record on each run and applies relevant accepted decisions while choosing its own lane-local work.

Integration & QA should assess current implementation against the intended product, challenge architectural drift and weak evidence, identify gaps and provide an honest cross-lane summary. It must distinguish owner-approved directives from proposals and unverified conversational suggestions. **The steering interface is not a dispatcher**: it may establish accepted programme priorities and cross-cutting acceptance criteria but may not schedule, spawn, pause, individually task workers or override live ownership, quality or human gates. Instructions are not durable until captured in the repository.

## Sixth permanent lane — owner approval

[Issue #49](https://github.com/techrote/INTUIT3D/issues/49) records the owner's approved sixth independent RUNTIME worker. Only `packages/workflow-runtime/**` is its write set; existing five lanes and Integration-only control of shared CI, workspace, status and steering are preserved. These documentation changes do **not** create or change schedules. Scheduswarm remains disabled.

## Seventh and eighth permanent lanes — owner approvals

[Issue #80](https://github.com/techrote/INTUIT3D/issues/80) and [issue #81](https://github.com/techrote/INTUIT3D/issues/81) record the owner's explicit 7 November 2026 approval of two further fixed independent hourly workers. The historical sixth-lane section still documents RUNTIME's admission; the **current total is eight**. Existing ownership, Integration-only shared configuration/CI/merge authority and no-dispatch principle remain intact. This document **does not schedule or change any worker**.

## Ninth and tenth permanent lanes — owner approvals

[Issue #134](https://github.com/techrote/INTUIT3D/issues/134) and [issue #135](https://github.com/techrote/INTUIT3D/issues/135) record the owner's explicit 7 November 2026 approval of two additional independent hourly implementation lanes. INTERCHANGE exclusively owns `packages/interchange/**` and ENGINEERING exclusively owns `packages/engineering/**`; neither may modify shared lockfile, workspace/CI/STATUS, native or other worker sources. The current total is **ten**. The prior eight-lane count remains historical; Integration retains guarded merging and shared startup authority, not dispatcher/scheduling control. The explicit startup/lockfile test gate admits the two new packages without treating mere source presence as successful qualification.

## Concurrency and isolation

At most one active writer per shared source file/contract. Research probes may run alongside product work if they write separate experimental files/PRs and have independent acceptance. Claim specific issue/PR/file set before writing, explicitly recognize existing owner; branch names `intuit/<lane>/<topic>`. If a collision exists, choose another dependency-ready objective, or produce an additive non-overlapping proposal.

Branch ownership is not lockless entitlement. The integrator merges only after current main reconciliation and exact-head checks; conflicts must not be overwritten or resolved by dropping features. Shared configurations, workflow files, official fixtures, status documents and dependency manifests are serialized to INTEGRATION.

## Integration conveyor

```
prototype/research or feature issue
   -> experiment with executable fixture and source pin
   -> candidate PR with tested contract
   -> exact-head CI plus negative/adversarial checks
   -> cross-lane consumer integration where needed
   -> INTEGRATION reconciles and merges
   -> single accepted main + updated status
   -> every worker re-reads main next run
```

No lane must obtain an external dispatch authorization to begin research. **All lanes** integrate research within their own subsystem continuously, and INTEGRATION promotes qualified results promptly, including small vertical slices before broad milestones are complete.

## Output expectations per session

Substantive source/test/artifact or measured experiment, review-ready PR or accepted merge, updated issue/handoff, exact evidence and next concrete priority. Read-only investigation alone is acceptable only when necessary to remove a measured blocker or evaluate a kernel/solver choice, and must have a falsifiable report and decision.

A session terminates even if work remains: record progress and stop. A later fixed hourly run independently decides what to work on from live repo truth; do **not** create successor envelopes, schedule new tasks, notify other tasks or wait for another role to issue instructions.

## Scheduswarm principles and explicit non-adoption

Adopt repository-truth precedence, non-overlapping write sets, admission, scoped evidence, serialized integration and explicit recovery principles from https://github.com/techrote/scheduswarm.

Do **not** activate scheduswarm v2's queue branch/Chrome dispatcher or publish next-prompt task envelopes for INTUIT3D. The project-level SCHEDUSWARM.md deliberately uses `status: disabled` so the two orchestration systems cannot double-dispatch. This may be changed only by the repository owner.
