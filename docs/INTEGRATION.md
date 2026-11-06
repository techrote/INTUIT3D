# INTUIT3D — integration and CI entrypoint

## Run it

Use Node.js 22 or later and npm 10-compatible lockfile format. No cloud service is necessary to execute the dependency-free foundation checks:

```sh
npm ci
npm run ci
```

When a native worker is available on Linux or WSL, also run `npm run ci:native`. This invokes `native/ci.sh` if and only if the native tree exists. A native tree without that gate **fails**, rather than silently omitting validation. The native smoke script owns reproducible toolchain, dependency pins and CMake/CTest invocation.

The root npm workspaces are `apps/*` and `packages/*`. A lane-owned workspace directory must have its own `package.json`, unique package `name` and an actual `test` script. The integration script executes every present workspace's declared `typecheck`, `lint`, `test` and `build` phases, noting omissions. An empty workspaces tree produces an **explicit NOT IMPLEMENTED** report and tests only the integration harness; it does not imply a working CAD application.

When you add or change package dependencies, make a small PR with the package manifest but coordinate root lockfile updates with INTEGRATION. The integrator is the only concurrent writer to root `package-lock.json` and CI files; merging requires `npm ci` on the exact candidate head. Do not replace a failing gate with a no-op script. If a new workspace has no functioning tests yet, keep its PR unmerged until meaningful tests exist or explicitly negotiate a new qualification contract.

## First independent oracle

`integration/fixtures/plate-two-holes.v1.json` specifies a 120×80×8 mm plate with two radius-6 mm circular through-holes. `tooling/plate-oracle.mjs` independently computes intended volume and surface area, and deliberately rejects intersecting/tangent/boundary holes. This is **an analytic design-intent fixture only**. It does not generate a B-rep or prove geometric validity, topology, STEP fidelity, kernel equivalence, volume returned by OCCT or graphical output. Future KERNEL/INTENT integration must compare actual evaluated solids and exported/imported STEP against this independently defined target, with explicit error budgets and source/target provenance.

## Evidence boundaries

At bootstrap, passing root CI means: (a) the no-dependency contract checker executed, (b) existing npm workspace phases ran and reported omissions, and (c) analytic oracle tests ran. It does **not** claim CAD end-to-end acceptance, native OCCT execution, STEP interoperability, graphical UI qualification or user acceptance.

Do not merge a cross-lane PR until the actual candidate head's relevant checks have completed and current-main compatibility, file ownership and failure records are reviewed. If CI cannot run, leave a PR open with precise blocker and executed local evidence rather than calling it qualified.

## Model admission (INTENT PR #8)

The root lockfile pins TypeScript 5.8.3 as a development dependency; do not rely on a globally preinstalled compiler or an unpinned CLI when qualifying TypeScript packages. `npm ci` must succeed on the **exact candidate tree**, including every newly admitted workspace package and its link entry in `package-lock.json`.

`tooling/tests/model-integration.test.mjs` is an end-to-end **semantic intent API** smoke test: it imports the `@intuit3d/model` TypeScript source when the package is present, exercises a cut authored before its plate, replay of retrospective dimension changes and explicit unordered-write conflicts. It checks the analytic plate fixture as an independent *intent-only* value, not as geometry. If `packages/model` has not yet been merged, the test reports an explicit `MODEL_NOT_IMPLEMENTED` skip; this is NOT a passed model acceptance gate.

When a model workspace is added to a PR or merged, the integrator must regenerate and commit the root npm lockfile from the *combined* source and verify `npm ci && npm run ci` on Ubuntu and Windows before accepting the package. All unexecuted native, graphical, STEP or usability gates remain separate.
