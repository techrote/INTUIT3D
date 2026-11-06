# INTUIT3D — five permanent scheduled workers

## Core policy

**Exactly five recurring scheduled tasks, one per permanent lane.** All are broad enough to sustain development for months but have unambiguous primary write ownership. Workers start on their fixed hourly schedule, fresh-audit GitHub, select work within scope, implement, validate and leave GitHub handoffs. **No central planner, no spawning scheduled successors, no Scheduswarm dispatcher queue, no chained tasks.**

Suggested stagger: INTENT at :00, SKETCH at :12, KERNEL at :24, WORKBENCH at :36, INTEGRATION at :48 (Europe/London). Actual runs may overlap; schedule staggering is a courtesy, not a transaction lock.

## Lane map

| Lane | Primary write authority | Sustained responsibilities | Required integration touch |
|---|---|---|---|
| INTENT | `packages/model/**` | Durable project schema, semantic document, intent command journal, dependency graph, partial rebuild, persistent references, repair/ambiguity state | Versioned model contract and tests consumable by web/kernel |
| SKETCH | `packages/sketch/**` | Sketch geometry, solver benchmarking/adapters, constraint diagnostics, profiles, projection, snaps, numerical correctness | Typed sketch commands, example fixtures and UX consumption notes |
| KERNEL | `native/**`, `packages/kernel-contract/**` | OCCT bootstrap, native/WASM experiments, isolated worker, exact geometry, STEP, validation, numerical/Boolean robustness | Versioned provider API, fixtures and export evidence |
| WORKBENCH | `apps/web/**` | Local 3D workbench, viewport, precision interaction, Fusion-inspired layout, timeline/graph, inspector, keyboard, usability | End-to-end user workflow referencing versioned model/kernel contracts |
| INTEGRATION | `package.json`, workspace/lockfiles, `.github/**`, docs shared statuses, cross-package wiring, CI/release | Exact-head qualification, reconcile and merge safe PRs, keep main runnable, ingest mature research prototypes, fix cross-package regressions | Publish accepted source SHA, conformance evidence, demo and unresolved risks |

Additional source trees may be created through PR discussion; write ownership must remain explicit. INTEGRATION does not own other lanes' feature development and must not become a central planner.

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
