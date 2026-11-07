# One-off model → pinned OCCT8 L-profile composition experiment

**Status: experimental, no merge; fail-closed.** All changes are under this
experiment directory. Base accepted main:
`156118e021cba6c431aa70cbfbd3a0bf5b04dcf6`.
Read-only source contract: KERNEL #67
`d18cee2861d487d82790d07d6c6e1eaa77f783b9`.
Official OCCT 8.0.1 source pin:
`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`.

## What actually composes

`scenario.mjs` uses real public INTENT, SKETCH, FEATUREOPS and RUNTIME
packages in the experiment worktree. It derives the actual selected
`cycle:` profiles from admitted solver sketches, commits the bracket
extrusion and independent spacer, commits one through cut and an ordered
3 mm blind cut, retrospectively changes the blind depth 3→5 and extrusion
thickness 8→12 mm, checks partial invalidation, undo/redo and model
archive replay. It revalidates SKETCH candidates and source signatures
from the *same live journal revision* before invoking
`requestFromRuntimeBodyCutChain` from the separate, read-only #67 tree.

`adapter.mjs` is a prototype of the missing versioned KERNEL consumer:
it converts ONLY a six-edge, counterclockwise, axis-aligned, centred
L-profile with exactly two disjoint rectangular hole-free cut tools
to `l-profile-cut-chain-v3`. It explicitly refuses arbitrary polygons,
non-centred sketches, rotated profiles, sketch islands, missing
identities/signatures, inconsistent cut order, wrong body or old revision.
It carries solver-signature, sketch-candidate and project provenance as
an **adapter sidecar**. The native v3 request itself only contains
reconstructed L dimensions and primitive cutter dimensions, **not**
the source SKETCH geometry/candidate IDs.

## Run in nonoverlapping worktrees

From an existing source checkout with clean worktrees:

```sh
git fetch origin
git worktree add --detach ../INTUIT3D-contract-experiment \
  origin/intuit/experiment/model-to-occt8-contract-20261107
git worktree add --detach ../INTUIT3D-kernel67 \
  d18cee2861d487d82790d07d6c6e1eaa77f783b9
cd ../INTUIT3D-contract-experiment
npm ci
node --test experiments/model-to-occt8-l-profile/adapter.test.mjs
npm test --workspace @intuit3d/model
npm test --workspace @intuit3d/sketch
npm test --workspace @intuit3d/feature-ops
npm test --workspace @intuit3d/workflow-runtime
INTUIT3D_KERNEL67_ROOT="$(realpath ../INTUIT3D-kernel67)" \
  node experiments/model-to-occt8-l-profile/scenario.mjs \
  "$(mktemp -d)"
```

Run from a **fresh output directory**, because output manifests and STEP
exports are written exclusively and may never overwrite existing files.

The scenario retains `pending_physical` if no matching compiled worker is
supplied. A real candidate run also needs
`INTUIT3D_OCCT8_WORKER=/absolute/pinned/worker` and
`INTUIT3D_OCCT8_SOURCE_SHA=b8f597c677811d1f9f4d8a97f5ae2825c0353a42`.
The source pin environment flag is **not by itself proof of binary
provenance**: the independent KERNEL/PLATFORM immutable source/build/worker
SHA manifest must accompany an admission submission. A returned report
remains `experimental_physical_only`; no STEP bytes are production-exact
or independently interoperable until downstream gates establish that.

## Test evidence and limitations

Local Node 22.16.0: 14/14 independent adapter-shape tests passed on
the packaged local equivalent; these are synthetic contract records
and **are not solver/native executions**. The complete GitHub-directory
scenario is written but **was not run here**, because the execution
container has no checkout/dependencies and cannot fetch GitHub through
DNS. Accepted-main hosted Ubuntu/Windows and Chromium tests previously
passed at main `156118e...` in CI #42394445518; that does not qualify
these new experiment files. Older pinned C++ real mixed/ordered STEP
execution passed in CI #42383946495, but the new L specialization at
PR #67's named head has not been demonstrated by this experiment.
No manufactured STEP/geometry success is recorded.

The analytic intent targets (separate, disjoint cuts) are:
8 mm bracket / 3 mm blind pocket: **33,825 mm³**;
12 mm bracket / 5 mm blind pocket: **50,575 mm³**.
These are independent arithmetic expectations, not measured results.

## One smallest production connection

**KERNEL owner** should adopt or replace the narrow adapter as
`@intuit3d/kernel-contract/runtime-occt8-l-profile/v1`
on its existing #67 source branch, consuming
`requestFromRuntimeBodyCutChain(history, bodyId, {runtime,model,requestId})`.
Expose one versioned consumer:
`evaluatePinnedSelectedL(history, bodyId, {runtime,model,sketch,discovery,
requestId,workerExecutable,readCurrentRevision,stepOutput,signal})`
returning `pending_physical | experimental_physical_only | unresolved`
and preserving `projectId, revision, SKETCH profileCandidateId,
sourceSignature, bodyId, featureIds, orderedCutIds`.
Its native invocation must retain the existing provider's cancellation,
exclusive STEP publication, revision and digest checks. For production
general sketch support, a **new KERNEL protocol** must convey the
admitted sketch contour rather than imply `v3` does.

**RUNTIME owner** may make this provider selectable as a capability-gated
consumer; no new runtime authority required.
**FEATUREOPS owner** should persist/verify selected base-profile provenance
as part of a versioned extrusion contract if durable selection must be
trusted by third-party consumers rather than only rederived. Existing
ordered cuts already maintain their own profileCandidateIds.
**INTEGRATION owner** should execute the exact-head hosted combined
scenario, preserve SHA and STEP geometry artifacts, and keep #74 open
until truly independent CAD STEP import and actual browser acceptance.

No other owned sources, workflows, shared files or PRs were modified.
