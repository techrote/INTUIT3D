# INTUIT3D — Owner Steering & Programme Assessment

**Status:** Live project authority and intake protocol. **Maintainer:** INTEGRATION & QA. **Readers:** all ten owner-approved permanent hourly lanes at the start of every run.

## Purpose

Provide one durable, project-wide interface between the repository owner and a continuously operating ten-lane engineering workforce. The owner may discuss progress, feature direction, UX, architecture and priorities with Integration & QA. The integration worker captures decisions in this document and/or linked GitHub issues/ADRs, ensures they are discoverable and assesses whether the real product meets the owner's intent.

This is **not** a central work planner. INTENT, SKETCH, KERNEL, WORKBENCH, RUNTIME, FEATUREOPS and PLATFORM continue to choose, prototype, implement and qualify independent dependency-ready tasks inside their scopes. INTEGRATION keeps code/CI coherent, qualifies/merges admissible PRs and records owner guidance. It must not spawn, pause or redirect other scheduled tasks.

## Authority and classification

- **Accepted owner decision:** an explicit instruction from the repository owner, recorded with date/source reference, exact requirement, scope and acceptance expectation. It is authoritative for product direction, subject to safety, licensing, verified geometric truth and stated release/qualification gates.
- **Owner preference / priority:** an explicit preference to guide lane-local selection without automatically blocking other valuable independent work.
- **Proposed / needs owner decision:** advice, possible trade-off, assumption, or agent inference; NOT automatically an accepted requirement or authority to delete work/change architecture.
- **Superseded:** keep linked history with the replacing decision and date; do not silently rewrite previous requirements.
- **Assessment / observation:** current repository or runtime evidence, not a product instruction. Record observed tests, exact PR/SHA/CI and uncertainties.

Avoid manufacturing owner approval from a chat summary, speculative feature suggestion, worker opinion or unrelated previous task. If direction conflicts with a technical safety or correctness invariant, retain the owner's objective, explain the conflict and propose a qualified implementation path. Never silently weaken geometric or export accuracy.

## How to submit direction

1. Discuss strategy, evaluate the current project or provide guidance in the Integration & QA conversation, or open an issue/comment in INTUIT3D.
2. The integration worker must transform substantive accepted decisions into a dated entry below and, when executable work is involved, a linked issue with measurable acceptance criteria and affected lane(s).
3. Cross-cutting contracts/architectural changes require an ADR or versioned contract proposal; affected workers can independently select appropriate changes from live GitHub state.
4. Workers must fresh-read this file and relevant issues on each scheduled run; they do not automatically share past ChatGPT conversation context.
5. If a directive is too ambiguous to formalise faithfully, record it as **proposed / clarification needed** rather than inventing a binding owner decision.

Owner input can be committed here by a repository maintainer acting on explicit owner instruction. Normally INTEGRATION owns subsequent edits and serves as a single writer for shared status/steering documents.

## Steering decision register

| ID | Classification | Directive or current standing direction | Scope / verification |
|---|---|---|---|
| ST-001 | Accepted founding direction | Prioritise a local-first, comprehensive Fusion-inspired CAD UX with strong direct manipulation, precise parametric tools, flexible handling of unconventional modelling operation order, retrospective constraints and recoverable errors. | Product-wide; docs/PRODUCT.md, docs/ARCHITECTURE.md and acceptance flows |
| ST-002 | Accepted founding direction | Pursue ambitious, rapid, predominantly agentic development through five **permanent fixed scheduled** lanes; no central task planner or spawn/stop/successor orchestration. | docs/ORCHESTRATION.md, AGENTS.md, SCHEDUSWARM.md |
| ST-003 | Accepted founding direction | Continuously examine radiCADSAC and other research tangents; promote qualified prototypes into functioning product capabilities or retain reproducible negative evidence. | docs/RESEARCH-INTAKE.md and linked PRs |
| ST-004 | Accepted owner steering interface | Use INTEGRATION & QA for holistic status assessment and guidance intake; write consequential direction into shared GitHub authority accessible to every lane. Integration is not a dispatcher. | This file, docs/ORCHESTRATION.md and startup audits |
| ST-005 | **Accepted owner decision, 2026-11-06** | Expand from five to **six** independent fixed hourly lanes by adding Workflow Runtime. Historical ST-002's *count* is superseded; its no-dispatch principle remains. | [Owner-approved issue #49](https://github.com/techrote/INTUIT3D/issues/49), `packages/workflow-runtime/**` only; original five ownership boundaries and single Integration merge authority unchanged |
| ST-006 | **Accepted owner delivery priority, 2026-11-07** | Favour connected runnable CAD features and verified user workflows over speculative defect chains, micro-regression PRs and document-only review cycles. Integrate mature RUNTIME/KERNEL and deliver an honest sketch→extrude→cut→retrospective edit→rebuild→undo/archive/STEP workflow; preserve all exactness/independent/human evidence gates. | [Integration deliverable #5](https://github.com/techrote/INTUIT3D/issues/5), [model/native execution PR #60](https://github.com/techrote/INTUIT3D/pull/60), six existing lane scopes; observable commands, passing native + graphical qualification, precise gaps to production acceptance |
| ST-007 | **Accepted owner decision, 2026-11-07** | Add independent seventh FEATUREOPS lane for new real mechanical part authoring and generalized parametric operations, not a parallel model/solver/kernel. | [#80](https://github.com/techrote/INTUIT3D/issues/80); exclusive `packages/feature-ops/**`; CI/lockfile and guarded merge remain Integration-owned |
| ST-008 | **Accepted owner decision, 2026-11-07** | Add independent eighth PLATFORM lane for reproducible pinned OCCT 8.0.1 C++ and truly independent non-OCCT STEP readback. | [#81](https://github.com/techrote/INTUIT3D/issues/81); exclusive `platform/native-toolchain/**` and `conformance/external-cad/**` |
| ST-009 | **Accepted owner decision, 2026-11-07** | Add independent ninth SKETCH INTERCHANGE lane for tested DXF import/export of analytic sketches with units and no parallel solver. | [#134](https://github.com/techrote/INTUIT3D/issues/134); exclusive `packages/interchange/**`, accepted SKETCH consumer/round-trip and typed API |
| ST-010 | **Accepted owner decision, 2026-11-07** | Add independent tenth ENGINEERING lane for model-derived measurements and deterministic dimensioned SVG drawings, without false physical-mass/STEP authority. | [#135](https://github.com/techrote/INTUIT3D/issues/135); exclusive `packages/engineering/**`, editable project/reopen/drawing fixture and accepted-main evidence |

These entries record the owner's already stated project objectives; they do **not** claim any feature is implemented, tested or released. Newly accepted decisions receive a new stable ID, date and issue/ADR reference when available.

### ST-005 — Sixth permanent Workflow Runtime lane

- **Recorded on:** 2026-11-06 (Europe/London).
- **Source:** [Owner-approved sixth worker, issue #49](https://github.com/techrote/INTUIT3D/issues/49).
- **Classification:** accepted owner decision; supersedes only the original five-lane count in ST-002, not the fixed independent/no-central-planner approach.
- **Exact scope:** dedicated `packages/workflow-runtime/**` worker bridging authoritative model commands, real sketch solving and kernel-provider evidence through additive versioned APIs. Existing INTENT/SKETCH/KERNEL/WORKBENCH/INTEGRATION writers remain unchanged; shared root, CI and policy stay Integration-owned.
- **Verifiable acceptance:** revision-fenced semantic and solver replay, explicit pending/ambiguous/stale/approximate/validated-exact states with provenance, negative tests preventing fabricated B-rep/STEP claims, and independent Integration admission. See #49 for complete conditions.
- **Not authorized here:** any schedule changes by Integration, dispatcher activation or automatic task succession. Production OCCT 8.0.1 C++, cross-platform native, independent STEP and human UX remain unqualified.

### ST-006 — Build-first feature integration and deliverable closure

- **Recorded on:** 2026-11-07 (Europe/London).
- **Source / owner direction:** Explicit 7 November 2026 owner delivery reset provided to the standing Integration & QA worker; tracked in [#5](https://github.com/techrote/INTUIT3D/issues/5) and executable [#60](https://github.com/techrote/INTUIT3D/pull/60).
- **Classification:** accepted owner priority, superseding any older *implicit* preference for incremental defect-only investigations or standalone status PRs; no change to explicit geometry, evidence, ownership or human acceptance rules.
- **Exact direction:** The majority of engineering effort should produce newly usable, connected sketch/extrude/cut/edit/rebuild/undo/archive/STEP capabilities on accepted main. Fix suspected severe defects when materially reproduced. Qualify and merge ready lane work promptly; keep a small number of clear user-outcome issues and close only demonstrably completed deliverables. Product demos and interfaces must distinguish semantic/planner authority, analytic preview, genuine OCP physical solids and independent STEP interoperability.
- **Impacted lanes:** All six within their existing exclusive write scopes. INTEGRATION retains guarded merges, shared CI, lockfile and this ledger. Nobody may reassign, spawn, pause or reschedule other lanes.
- **Verification:** runnable non-mock semantic→sketch→native STEP fixture; correct retrospective changed dimensions and dependency invalidation; two actual STEP files/readback evidence; abort/corruption gates retained; exact-head Ubuntu/Windows and Linux native qualification; actual browser checks for UX. Production OCCT 8.0.1 C++, independent external STEP reader, topological lineage, Windows-native and human acceptance remain distinct unfinished gates until executed.
- **Implementation references:** [RUNTIME #51](https://github.com/techrote/INTUIT3D/pull/51), [KERNEL #54](https://github.com/techrote/INTUIT3D/pull/54), [INTENT #58](https://github.com/techrote/INTUIT3D/pull/58), [WORKBENCH #59](https://github.com/techrote/INTUIT3D/pull/59), [INTEGRATION #60](https://github.com/techrote/INTUIT3D/pull/60). CI and accepted-main evidence must be confirmed separately; a merge is not a test pass.
- **Supersedes:** no numbered engineering safety requirement or ST-005. Extends ST-001 delivery priorities and ST-003 research-to-tested-product expectations.

### ST-007 and ST-008 — New product implementation lanes

- **Recorded and classified:** 7 November 2026, explicitly owner-approved decisions in [FEATUREOPS #80](https://github.com/techrote/INTUIT3D/issues/80) and [PLATFORM #81](https://github.com/techrote/INTUIT3D/issues/81).
- **Ownership:** FEATUREOPS writes only `packages/feature-ops/**`; PLATFORM writes only `platform/native-toolchain/**` and `conformance/external-cad/**`. No other lane's write set changes. INTEGRATION alone owns shared manifests, checks, status, admission and merges.
- **Observable acceptance:** a new part authored/rebuilt/undoable through accepted semantic contracts; real pinned C++ executable/STEP and independently reconstructed external CAD geometry with preserved artifacts. Experimental OCP and a custom STEP text checker do not constitute production or independent external CAD qualification.
- **Prior authority:** expands only the historical six-lane count of ST-005, retaining no-dispatch, explicit exactness gates and immutable existing source ownership. These edits neither create nor alter schedules.

### ST-009 and ST-010 — Newly approved sketch exchange and engineering output

- **Recorded/classified:** 7 November 2026; accepted owner decisions, evidenced by [#134](https://github.com/techrote/INTUIT3D/issues/134) (DXF exchange) and [#135](https://github.com/techrote/INTUIT3D/issues/135) (engineering drawings).
- **Exact scope:** two *additional* independent permanent lanes: `packages/interchange/**` and `packages/engineering/**`. Existing eight ownership boundaries remain intact. INTEGRATION exclusively changes shared npm lock/workspace checks and admits PRs with current-main qualification.
- **First acceptance:** interchange reads real bounded ASCII DXF shapes with units/layers/analytic circles/arcs, edits via accepted SKETCH, exports/reimports with verified physical dimensions; engineering derives a dimensioned A3 top-view SVG and measured hole table from accepted INTENT/SKETCH, including saved-archive edit/reopen, deterministic revisions, safety/provenance and truthful analytic-only status.
- **Integration outcome:** `tooling/check-workspace.mjs` recognizes both exact package paths; lock reservation for the current ENGINEERING #137 package is a tested integration prerequisite, not qualification of the still-unmerged drawing code. Advance candidate artifacts only after source-matched hosted checks. No schedule/dispatcher changes by Integration.
- **Qualification boundary:** SVG sketch measurements are not OCCT physical mass; DXF syntax/round-trip alone is not STEP conformance. Production native, independent external STEP and human UX continue separately under #74.

## Intake entry template

### ST-NNN — Short decision name

- **Recorded on:** YYYY-MM-DD (Europe/London)
- **Source / owner request:** URL to issue/PR/comment or owner-authorised recorded instruction
- **Classification:** accepted decision / owner preference / proposed / superseded
- **Exact direction:** concise affirmative specification; distinguish what was requested from integrator interpretation
- **Why / priority:** effect on product, user workflow, engineering or delivery
- **Impacted lanes:** INTENT / SKETCH / KERNEL / WORKBENCH / INTEGRATION
- **Acceptance:** observable product behaviour, numerical/geometry correctness and required tests
- **Implementation links:** issues, PRs, ADRs, exact accepted merge SHA
- **Open questions / qualification gates:** unresolved conflicts, human decisions, missing evidence
- **Supersedes:** stable IDs, if any

Do not create duplicate entries for discussions that have not changed direction.

## Standing Integration & QA assessment responsibility

On every substantive run, inspect the *live* default branch, current head and exact-head CI, all significant lane PRs and blockers, and reachable user-visible workflows. Maintain a concise evidence-based programme assessment in docs/STATUS.md or a linked, dated review issue when changes are material:

- **Implemented and integrated:** which user workflows actually work from accepted main, by source and test evidence.
- **In development:** lane features, PR status, unintegrated prototypes and measured progression.
- **Not yet qualified:** missing native/graphical/independent/human acceptance; distinguish absent evidence from failed tests.
- **Risk and drift:** architectural divergence, regression, incompatible interfaces, missing UX capabilities, numerical correctness risks and stalled integrations.
- **Highest-value cross-lane opportunities:** recommendations and dependency blockages, not task dispatches.
- **Owner decisions needed:** genuinely consequential product trade-offs and conflicts, without routine clarification requests.

Every important recommendation should be grounded in reproducible findings; do not invent progress, delivery dates, performance or acceptance. Update the status only when evidence changes materially—do not churn a shared file merely to report that there was no change.

## Dissemination / execution semantics

All six worker prompts and AGENTS.md require rereading this document at run start. Accepted directives guide each lane's autonomous priorities. An owner-approved cross-lane feature may generate independently owned linked issues; no shared file or developer branch becomes a free-for-all. INTEGRATION handles shared source/contracts and merges after appropriate qualification.

**Steering is not scheduling**: don't create new automations, invoke run-now, reschedule, enable Scheduswarm dispatch or block independent work while waiting for a planning session. If the user separately asks for those actions, treat them as an explicit new request.

## Next owner review

Once the first functioning vertical slice is on main, assess whether an unfamiliar Fusion-competent user can create and modify a dimensioned sketch, extrude/cut a body, change an earlier operation, recover from an unresolved dependency, save/reopen and export reliable STEP—without needing feature-tree discipline. Track gaps between real behaviour and these goals.
