# INTUIT3D — live integration status

**Assessed 6 November 2026 after PR #13 model/sketch admission.** This index describes accepted code and measured evidence; it is not a CAD release or a substitute for live GitHub checks.

## Accepted main and qualified contract slices

- **Accepted main at this assessment:** `100ffbe7446565559eab2b6630737626abb38c69` — [PR #13](https://github.com/techrote/INTUIT3D/pull/13) integrated exact source trees from [INTENT #8](https://github.com/techrote/INTUIT3D/pull/8) head `3371537b55604747a8d1fe49f54d89ab54e6f4cf` and [SKETCH #11](https://github.com/techrote/INTUIT3D/pull/11) head `3eccc3fbe3b724d8c16e3a4deebc3796fc9de8d6`. GitHub marked both source PRs merged through recorded commit ancestry. No lane source was overwritten.
- **Exact-head qualification:** [PR #13 GitHub Actions #42247137499](https://github.com/techrote/INTUIT3D/actions/runs/42247137499), head `10bbe32b8449e56f397b4c3a8d78542812f85251`: **Ubuntu and Windows passed** with actual locked `npm ci`. Each OS executed 15 root integration tests, 34 model tests, 28 sketch tests, model strict TypeScript check and an independent integration-owned TypeScript sketch declaration consumer check. These are real executed gates, not bootstrap skips. [Post-merge main Actions #42247394881](https://github.com/techrote/INTUIT3D/actions/runs/42247394881) must separately be checked for final post-merge status.
- **INTENT admitted as limited versioned contract:** an append-only semantic project journal, stable feature IDs, authored chronology separated from dependency graph, pending and conflict diagnostics, save/reopen replay, and scalar unit-aware parameter-expression gates. A `ready` feature is **dependency-admissible only**, not proven geometrically valid.
- **SKETCH admitted as limited versioned contract:** a deterministic **linear** constraint solver, diagnostics for degrees of freedom, contradiction and redundant constraints, dimension edits and transient rejected drags, plus an **analytic-only** rectangular plate/two-hole profile. It is not a nonlinear general solver or robust B-rep/profile predicate authority.
- **Integration:** cross-package fixture exercises a forward-authored cut/extrude/sketch history, retrospective width edit and JSON replay, while comparing sketch analytic area against the independent plate analytic intent oracle. This is **not** exact geometry or STEP proof.
- **Infrastructure:** [PR #7](https://github.com/techrote/INTUIT3D/pull/7) introduced Ubuntu/Windows npm workspace and analytic fixture gates; [PR #10](https://github.com/techrote/INTUIT3D/pull/10) pinned TypeScript 5.8.3 and installed the model consumer test. Both merged with hosted checks.

## Candidates requiring further admission

- **[WORKBENCH PR #9](https://github.com/techrote/INTUIT3D/pull/9) — Draft:** React/Vite/Three UI preview source, keyboard interactions, editable visual sketch and local JSON state. Current candidate requires **shared lockfile regeneration** for React/Vite/Three dependencies, actual exact-head typecheck/build and browser/render interaction evidence. Prior CI stopped at `npm ci`; no graphical acceptance has occurred. Preview state must not displace the authoritative model now on main.
- **[KERNEL PR #12](https://github.com/techrote/INTUIT3D/pull/12) — Draft:** experimentally implemented Python OCP 7.9.3.1 real B-rep Boolean plate/holes and STEP internal readback, constrained typed protocol, process supervisor and bounded structural export guard. [Exact-head Ubuntu native plus Windows workspace CI passed](https://github.com/techrote/INTUIT3D/actions/runs/42243969380) before model/sketch integration. Separate integration admission is needed, with explicit experimental-only status. **Not** pinned OCCT 8.0.1 C++ production kernel; no independent STEP consumer or Windows-native test evidence.

## Known gaps / next highest-value integration

1. Confirm post-merge `main` checks; preserve exact SHA and source custody.
2. Admit #12's bounded native experiment only after source/CI review against current main; never promote its OCP wheel or STEP claims to production by implication.
3. Reconcile the shared lockfile for #9 against newly admitted model/sketch packages, qualify `npm ci`, TypeScript, Vite production build and actual graphical interaction before merging. Do not invent a green browser check from source-only tests.
4. Build an explicitly versioned model/sketch/kernel-to-workbench adapter and an observable save/reopen/modify/extrude/cut/STEP vertical slice, separating analytic preview from validated exact B-rep.
5. Continue kernel-independent semantic topology lineage, nonlinear sketch solver/predicate evaluation and independent STEP interchange work, with rigorous adversarial evidence.

**Unqualified:** general CAD feature topology, pinned OCCT 8.0.1 production C++ kernel, independent STEP interoperability, end-to-end GUI/viewport, native Windows geometry, full save/reopen solid regeneration, human usability and release packaging. No public release claim.

**Steering:** [OWNER-STEERING.md](OWNER-STEERING.md) is the owner direction register. Integration & QA owns repository-level evidence/merge coherence, not scheduling or dispatching the four permanent independent lanes. Live GitHub status overrides this dated snapshot.
