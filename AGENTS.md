# INTUIT3D — agent engineering contract

Applies to **every** agent implementation, research, validation and integration session. Read this file and the relevant documents under docs/ before any substantive work. Live repository main, issue/PR discussions and verified CI supersede saved prompts and old handoffs.

## Mission

Build an ambitious, local-first, engineering-grade, intent-first parametric CAD package with Fusion-inspired interaction. Deliver working code at high velocity without sacrificing geometric truth. The defining product capabilities are: non-chronological intent and dependency-aware evaluation, retrospective constraints/parameters, direct + parametric editing, durable semantic references and explicit recovery from unsolved operations.

The long-lived programme has **eight owner-approved permanent scheduled worker lanes** ([#49](https://github.com/techrote/INTUIT3D/issues/49), [#80](https://github.com/techrote/INTUIT3D/issues/80), [#81](https://github.com/techrote/INTUIT3D/issues/81)). Each worker owns a broad, clearly bounded subsystem, selects its own highest-value dependency-ready work on every run and does not need a central planner. **Do not spawn, schedule, pause or redirect other workers, and do not create scheduswarm queue successors.** A standing integration lane is a code integrator and quality owner, *not* a dispatcher or centralized selector of other lanes' work.

## Mandatory fresh audit

At every run:
1. Read current main HEAD, latest merges, issues/PRs, workflows/checks, **docs/OWNER-STEERING.md** (accepted owner decisions and open steering), release/architecture decisions, relevant lane-specific documents and existing tests.
2. Identify live owners and file/contract overlap before writing; preserve in-flight work. Prefer finishing or repairing a directly relevant existing PR over producing a duplicate.
3. Choose one substantial, bounded and testable improvement within your lane. Ambition and speed are expected; a session should produce executable progress where feasible, not only an assessment.
4. Record source/base SHA and expected acceptance criteria; use a dedicated `intuit/<lane>/<issue-or-topic>` branch and PR. Keep experiments as intentionally named prototypes until qualified.
5. Run applicable checks and adversarial fixtures; make negative evidence reproducible. Put status, exact commands, outputs and unresolved gaps in the PR/issue.
6. Update only your own lane's status/issue/PR. Shared roadmap/STATUS, top-level policies, lockfiles/workspace integration, and official acceptance baselines belong to INTEGRATION, with versioned proposals from other lanes.
7. Finish with a durable handoff in GitHub. **Record progress and stop.** No polling-only follow-on, task creation or background work.

## Lane ownership (source of truth: docs/ORCHESTRATION.md)

- **INTENT:** `packages/model/**` — authoritative document, semantic identity, history, dependency DAG, incremental replay, references, pending-intent/repair state.
- **SKETCH:** `packages/sketch/**` — precise 2D geometry, constraints, sketch solver adapter, DOF diagnostics, profiles and deterministic sketch fixtures.
- **KERNEL:** `native/**`, `packages/kernel-contract/**` — pinned OCCT experiments and integration, isolated workers, exact B-rep, validation, STEP, measured fallback strategy.
- **WORKBENCH:** `apps/web/**` — React/TypeScript local interface, viewport, UX, command routing, timeline/dependency graph, selection and direct manipulation.
- **RUNTIME:** `packages/workflow-runtime/**` — authoritative application workflow bridge using versioned INTENT/SKETCH/KERNEL contracts, revision-fenced results and explicit preview/pending/exact provenance, approved in [issue #49](https://github.com/techrote/INTUIT3D/issues/49).
- **FEATUREOPS:** `packages/feature-ops/**` — versioned mechanical operations using existing INTENT/SKETCH/RUNTIME/KERNEL, owner-approved [#80](https://github.com/techrote/INTUIT3D/issues/80).
- **PLATFORM:** `platform/native-toolchain/**`, `conformance/external-cad/**` — pinned OCCT build/provisioning and truly independent CAD STEP qualification, owner-approved [#81](https://github.com/techrote/INTUIT3D/issues/81); no edits to KERNEL-owned `native/**`.
- **INTEGRATION:** shared workspace/CI, top-level configs, cross-lane compatibility, qualification, orderly merges, demos, official evidence/roadmap/status; **owner steering intake, evidence-based programme assessment and durable routing of approved direction**; proactively integrate qualified research and feature PRs.

Owner steering is authoritative only when explicitly accepted and recorded. Workers should read docs/OWNER-STEERING.md every run, apply decisions relevant to their owned lane, and maintain their independent task selection; INTEGRATION maintains the steering ledger but is not a dispatcher or supervisor. A steering conversation not recorded in GitHub is not automatically visible to other scheduled workers.

Ownership is a conflict-avoidance convention. Cross-lane API change: propose an additive/versioned contract, discuss the consumer, then merge under INTEGRATION. No lane has permission to overwrite another lane's active work.

## Non-negotiable correctness

- Authoritative design documents are not OCCT `TopoDS_*`, visual meshes, transient face/edge numbers or cache keys. Preserve typed, versioned semantic IDs and operation history.
- Creation chronology and dependency-required evaluation order are separate. Reorder only when semantically safe, and preserve visible ambiguity/contradiction.
- Invalid/pending operations remain editable. If showing last-good geometry, label it as stale, never current exact truth.
- No silent tolerance enlargement, topology repair, component loss, body-target inference, geometry approximation or export substitution.
- Provider boundaries remain replaceable and version-pinned. Kernel crash/hang/global-state contamination must not corrupt the project.
- Distinguish source inspection, executable test evidence, cross-provider comparisons, actual native or graphical runs and human visual/interaction acceptance.
- Keep end-to-end CAD flows working; test save/reopen/replay and STEP round-trip where applicable. Benchmarks must state platform, fixture, run conditions and actual measurements.
- No telemetry, account, network solver or cloud dependency. Local server binds loopback, checks origin, and limits filesystem access.
- Check and preserve third-party licenses and provenance; do not silently add conflicting dependencies or assign the overall project a license without owner decision.

## Tangent-to-product protocol

A worthwhile tangent must not stagnate in perpetual research. Attach a clear hypothesis, exact fixture, prototype/code, comparison against the current baseline, measured outcome and integration disposition (`adopt`, `repair then adopt`, `reject`, `defer with blocker`). Each lane can run prototypes in its owned code. INTEGRATION cross-checks qualification and merges admitted slices; it is not required to authorize research itself. Keep both positive and negative findings.

## PR handoff and gates

Every PR includes: selected issue; source and head SHA; scoped owner; changed interface surface; test commands, results and artifacts; known deviations; performance when relevant; next dependency-ready step. Draft is unqualified, not equivalent to accepted. Do not merge a head with material failures, unresolved source overlaps, unvalidated exact-geometry claims or bypassed human requirements. Main must remain usable. Every failure/limitation remains explicit and linked to an issue.
