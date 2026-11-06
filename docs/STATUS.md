# INTUIT3D — live integration status

**As assessed 2026-11-06, after PR #7 merge.** This is an evidence index, not a planner or certification of the CAD package.

- **Accepted main (at assessment):** `02b31905bce4d0a01353691df6a80b3e5118c4a9`, merged [PR #7](https://github.com/techrote/INTUIT3D/pull/7) after exact-head [Ubuntu and Windows Node 22 CI](https://github.com/techrote/INTUIT3D/actions/runs/42230307266) passed on candidate `038f5354429c1748175f0abddf6ac12bf6ba23e5`. This qualifies the bootstrap integration runner and independent analytic fixture only.
- **Accepted capabilities:** root npm workspace/CI gate, explicit absent-lane diagnostics, native absence guard, and independent **analytic intent** oracle for a 120×80×8 mm plate with two 6 mm radius through-holes. Analytic expected volume: `74990.44263153228 mm³`; it is not measured B-rep volume.
- **In-flight:** [INTENT PR #8](https://github.com/techrote/INTUIT3D/pull/8) is a Draft semantic-document implementation, source head `8db82f435c8d49dc4a0ff24d69070a4fb37e6981`, locally reported as 18/18 tests and typecheck, not yet exact-head hosted-qualified. Other lanes' current PRs require fresh checking at every run.
- **Integration candidate:** root TypeScript toolchain pin and model consumer contract smoke (pending hosted CI); model smoke explicitly skips if `packages/model` is absent from accepted main.
- **Not yet qualified:** real sketch solver, GUI/browser interaction, OCCT native execution, exact B-rep, geometric topology validation, STEP roundtrip/interoperability, end-to-end app save/reopen, and human CAD usability. No public release claim.
- **Acceptance priority:** integrate qualified package PRs in dependency order while keeping root lockfile synchronized on the combined exact source. Test the real plate/extrude/cut workflow only once providers exist; never equate dependency-plan `ready` or analytic intent with validated geometry.
- **Steering:** [Owner Steering](OWNER-STEERING.md) records the five independent fixed lanes and product direction; Integration & QA is an assessment/code integration lane, not a dispatcher.

**Maintenance:** Integration & QA updates this file when accepted main or materially verified evidence changes. Consult live PRs and checks rather than inferring a release state from this snapshot.
