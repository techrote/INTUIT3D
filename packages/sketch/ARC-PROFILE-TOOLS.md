# Solved arc-profile interaction tools v1

`@intuit3d/sketch/arc-profile-tools/v1` provides revision-fenced, **journal-neutral** nonlinear sketch manipulation. It exposes line/arc dimension and hole handles even when the sketch is conflicted (for repair), commits a signed/typed width or corner-radius edit, converts a pointer target to an authored dimension, delegates an existing circle edit, or proposes a complete one-shot rectangular array of circular holes. One accepted result contains an immutable sketch+selection+validated analytic profile for a *single* INTENT/RUNTIME journal commit; refusals leave source untouched.

Arrays use a selected circle as row 0/column 0, add other copies with stable IDs `<patternId>:r<row>c<col>`, and preserve independent fixed centres and radii through later retrospective width/corner changes and JSON reopen. Arrays are **one-shot, not associative**. No guessed tolerances, body-selection semantics or parallel revision authority are introduced.

Run from repo root:
`node packages/sketch/examples/arc-profile-tools.mjs`
`node --test packages/sketch/test/arc-profile-tools.test.mjs`
`npm run typecheck --workspace @intuit3d/sketch`

The nonlinear Levenberg–Marquardt solver and global analytic profile checks both execute. `providerSubmissionReady: true` means *only* suitable for a separate native submission; **no OCCT B-rep, independent STEP, browser qualification or human review** is claimed. A real WORKBENCH/RUNTIME integration must record one application transaction per accepted proposal and reject stale stamps; it must not treat these analytic profiles as validated exact solids.
