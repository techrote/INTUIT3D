# INTUIT3D — engineering and integration gates

## Every PR

- Record exact main/base SHA, candidate head SHA, source dependency versions and changed contracts.
- Build/test relevant code; include executed command, environment and result. Keep failing evidence and quarantine explanations.
- Supply deterministic positive and adversarial tests. New features must be tested after save/reopen/replay where stateful.
- Pass static checks, unit/integration checks, and relevant cross-package compile contract. UI changes additionally require an actual rendered/browser check or explicitly state that it was not executed.
- Performance claims require reproducible measured comparisons, including fixture and machine details. A planned test is not a passed test.
- Do not merge unresolved material regressions, silent geometry corruption, security breakage or duplicate writer conflicts.

## Geometric correctness hierarchy

1. **Intent:** inputs/constraints, target body selection, parameters and operation semantics preserved.
2. **Structural geometry:** B-rep is valid and body/face connectivity is as intended.
3. **Numerical/physical oracle:** analytic dimensions, volumes, surfaces, contact classifications, positive cuts and tolerances are within declared budgets.
4. **Replay:** same version/configuration yields equivalent semantic and geometric result.
5. **Exchange:** STEP and other exports meet protocol, exact body selection, units, read-back and external consumer tests.

A successful OCCT API return or valid B-rep is not sufficient proof of intent; radiCADSAC has measured counterexamples. STEP write success is not independent interoperability proof.

## Required adversarial families

- under-, over- and inconsistently constrained sketches;
- dependency cycles, future targets and temporarily missing references;
- changed early dimensions and edits after dependent features;
- feature reorderings that commute versus ones that do not;
- split, merge, deleted and geometrically ambiguous referenced faces/edges;
- coincidence, tangency, slivers, tiny positive cuts and long Boolean chains;
- multi-body results, zero-material and disconnected components;
- worker timeouts/crashes and process-global option interference;
- interrupted saves, migrations, undo/redo and deterministic replays.

## Test evidence labels

`source_only`: code inspection or docs.
`executed`: actual code/test command and logs on an identified runtime.
`independent`: external implementation/parser or independently defined oracle, not merely replay through same code.
`graphical`: real browser/GPU or software renderer frame and interaction.
`human`: user-confirmed UI/UX or engineering acceptance.

Always distinguish missing evidence from failed evidence.

## Release gating

Do not call experimental WASM, STEP conformance, CAD accuracy, cross-platform packaging or usability 'qualified' based on unrelated CI. Record what platform actually ran. Human usability acceptance is a separate gate, not automatically supplied by screenshots.
