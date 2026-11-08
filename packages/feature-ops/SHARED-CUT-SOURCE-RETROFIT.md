# Selected shared-cut source retrofit v1

**Public import:** `@intuit3d/feature-ops/shared-cut-source-retrofit/v1`.

`replaceSharedCutProfiles(history,request,{runtime,model,sketch,discovery,cutSource})`
lets a CAD consumer change the selected profile feeding **2–16 existing cuts**
in one undoable, durable, revision-fenced transaction. Unlike changing sketch
dimensions in place or reassigning an isolated cut, this operation replaces
the source SKETCH of multiple independently targeted bodies while preserving
the identities, body targets, blind/through extents and dependency-ordered
cut feature IDs. An optional displaced SKETCH is retired only if INTENT proves
nothing still references it.

**SKETCH must already contain each replacement**: accepted solver/profile
discovery must produce exactly one canonical `cycle:` candidate and match
the authoritative RUNTIME `analytic_profile_only` report at this revision.
No inferred body target, current-state face index, synthetic sketch, implicit
profile choice or stale UI selection can silently get through. The command
delegates all structural edits to the accepted INTENT
`previewCutProfileSourceBatch` contract, commits through RUNTIME once, and
returns per-cut `pending_exact_provider` or `blocked_dependency` statuses.

A real example migrates an L-shaped machine guard's blind relief cut and an
independent backing rail's through cut to a resized shared sketch, retires
the old sketch, undoes/redoes, reopens, edits the guard's extrusion thickness,
and edits the new shared sketch. It verifies that the unrelated shim stays
unchanged and that changing the shared source invalidates both dependent cuts.

```sh
node --experimental-strip-types packages/feature-ops/examples/shared-cut-source-retrofit.mjs
npm test --workspace @intuit3d/feature-ops
```

**WORKBENCH:** expose multi-select cuts → Replace source sketch/profile,
show each explicit target body, expected old source and new canonical profile,
and an opt-in checkbox to retire the displaced sketch. If a source is used
elsewhere, retirement is refused instead of deleting user design intent.
RUNTIME holds the undo/archive and evaluation authority. KERNEL must separately
execute and qualify generalized native Booleans. This API does not run B-rep,
STEP or a browser, and therefore claims **no exact native/export acceptance**.

All source changes are restricted to `packages/feature-ops/**`.
INTEGRATION owns independent current-main review, workspace/CI and merge.
