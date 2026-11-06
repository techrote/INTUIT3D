# INTUIT3D — executable programme

**Priority:** ambitious early vertical slices, then continuously deepened correctness and UX; no research-only phase blocking progress.

| Milestone | Capability | Demonstrable gate |
|---|---|---|
| M0 | Repo foundations, cross-platform CI, local dev environment, typed document/provider contracts, kernel/solver spike | Reproducible build and fixture/test harness; decisions cite executed comparison |
| M1 | Workbench shell, viewport, selection, commands, project persistence/undo | Local browser workbench opens/saves/reopens a project reliably |
| M2 | Precision 2D sketch, constraints/DOF, profiles, dimension editing | Measured sketch fixture suite plus interactive editing |
| M3 | Exact 3D bodies, extrude, cut, revolve, validation and STEP | Dimensioned mechanical plate reconstructed and independently compared after STEP export |
| M4 | Authoring-history + dependency-DAG split, pending features, partial rebuild | Representative unconventional operation-order suite passes |
| M5 | Durable semantic topology and split/merge/replace lineage | Reference-recovery adversarial suite passes or ambiguity is explicitly retained |
| M6 | Direct + parametric hybrid editing and imported geometry | Mixed workflow remains editable through save/rebuild |
| M7 | Advanced fillets, shells, sweeps, lofts, patterns, surfaces | Numerical and semantic acceptance corpus passes |
| M8 | Assemblies, configurations, drawings, measurement tools | Representative multi-component engineering task completes |
| M9 | Portability/performance/security and release readiness | Cross-platform exact-head gates and explicit human UX/device acceptance |

## Immediate, parallel foundation objectives

- **INTENT**: concrete versioned document schema, stable IDs, feature-graph insertion/edit/replay, cycle/pending diagnostics; runnable tests.
- **SKETCH**: solver benchmark harness and usable sketch primitives/dimensions/constraint API; working test fixture or interactive demo.
- **KERNEL**: pinned native OCCT build/probe, worker protocol, Boolean/STEP tests, crash isolation and comparisons to radiCADSAC evidence.
- **WORKBENCH**: bootable local React/Vite/three.js shell, working selection, precision sketch interaction, inspectable tree/timeline and UX screenshots.
- **INTEGRATION**: workspace wiring, head CI for JS/C++ as runnable, an integration smoke demo, acceptance gates, merge/risk register and first qualified cross-lane PR.

Each lane selects its next highest-value increment itself from current issues, dependency readiness, breakages, research results and observed gaps. Do not wait for a central planner. If blocked on cross-lane code, complete a compatible mock/adapter/probe or an independent improvement, record the dependency and avoid conflicting writes.

## Priority order

1. Broken main, lost user data, invalid geometry claimed valid or a trusted check regression.
2. Unblock an in-flight qualified feature or cross-lane contract.
3. Deliver the smallest high-value integrated feature that expands the first vertical slice.
4. Repair a measured fragility, numerical/geometric edge case or performance bottleneck.
5. Investigate valuable new research with an executable prototype and explicit adoption path.

## Evidence and status

All status is GitHub-truth-linked. Integrator maintains docs/STATUS.md with accepted main SHA, integration points, PR candidates, blockers, test coverage and open architectural decisions; no editable task queue is a second source of truth.
