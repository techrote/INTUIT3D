# INTUIT3D — six permanent scheduled workers

## Core policy

**Six fixed recurring workers, one per lane, as explicitly approved in [issue #49](https://github.com/techrote/INTUIT3D/issues/49).** All are broad enough to sustain development for months but have unambiguous primary write ownership. Workers start on their fixed hourly schedule, fresh-audit GitHub, select work within scope, implement, validate and leave GitHub handoffs. **No central planner, no spawning scheduled successors, no Scheduswarm dispatcher queue, no chained tasks.**

Suggested stagger: INTENT at :00, SKETCH at :12, KERNEL at :24, WORKBENCH at :36, INTEGRATION at :48 (Europe/London); owner-approved RUNTIME at :54 UTC (issue #49). Actual runs may overlap; schedule staggering is a courtesy, not a transaction lock.

## Lane map

| Lane | Primary write authority | Sustained responsibilities | Required integration touch |
|---|---|---|---|
| INTENT | `packages/model/**` | Durable project schema, semantic document, intent command journal, dependency graph, partial rebuild, persistent references, repair/ambiguity state | Versioned model contract and tests consumable by web/kernel |
| SKETCH | `packages/sketch/**` | Sketch geometry, solver benchmarking/adapters, constraint diagnostics, profiles, projection, snaps, numerical correctness | Typed sketch commands, example fixtures and UX consumption notes |
| KERNEL | `native/**`, `packages/kernel-contract/**` | OCCT bootstrap, native/WASM experiments, isolated worker, exact geometry, STEP, validation, numerical/Boolean robustness | Versioned provider API, fixtures and export evidence |
| WORKBENCH | `apps/web/**` | Local 3D workbench, viewport, precision interaction, Fusion-inspired layout, timeline/graph, inspector, keyboard, usability | End-to-end user workflow referencing versioned model/kernel contracts |
| RUNTIME | `packages/workflow-runtime/**` | Application command/evaluation bridge consuming versioned model, sketch and kernel interfaces; truthful pending/stale/preview/exact statuses without duplicating domain engines | Public workflow runtime contract and executable integrations, no root/CI writes |
| INTEGRATION | `package.json`, workspace/lockfiles, `.github/**`, docs shared statuses and `docs/OWNER-STEERING.md`, cross-package wiring, CI/release | Exact-head qualification, reconcile and merge safe PRs, keep main runnable, ingest mature research prototypes, **receive owner guidance, maintain evidence-based programme assessment and publish durable steering decisions** | Publish accepted source SHA, conformance evidence, demo, unresolved risks and owner-steering decisions |

Additional source trees may be created through PR discussion; write ownership must remain explicit. INTEGRATION does not own other lanes' feature development and must not become a central planner.

## Owner steering and assessment

**Owner-to-project interface:** the owner may discuss product direction, priorities, architectural trade-offs or current-state assessment with Integration & QA. That worker maintains [docs/OWNER-STEERING.md](OWNER-STEERING.md) as a shared, explicit steering record and opens/updates targeted GitHub issues or ADRs for independently actionable decisions. Every worker reads the shared record on each run and applies relevant accepted decisions while choosing its own lane-local work.

Integration & QA should assess current implementation against the intended product, challenge architectural drift and weak evidence, identify gaps and provide an honest cross-lane summary. It must distinguish owner-approved directives from proposals and unverified conversational suggestions. **The steering interface is not a dispatcher**: it may establish accepted programme priorities and cross-cutting acceptance criteria but may not schedule, spawn, pause, individually task workers or override live ownership, quality or human gates. Instructions are not durable until captured in the repository.

## Sixth permanent lane — owner approval

[Issue #49](https://github.com/techrote/INTUIT3D/issues/49) records the owner's approved sixth independent RUNTIME worker. Only `packages/workflow-runtime/**` is its write set; existing five lanes and Integration-only control of shared CI, workspace, status and steering are preserved. These documentation changes do **not** create or change schedules. Scheduswarm remains disabled.

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
