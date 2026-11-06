# Constraint-preserving preview drag API v1

Import `@intuit3d/sketch/drag-projection/v1`. Existing `suggestDrag` is unchanged.

It attempts the cursor X/Y as temporary sketch dimensions; if one is inconsistent, it keeps the coordinate supported by the unchanged authored equations. It returns `ready`, `projected`, `blocked`, `conflicted` or `numerical_failure`, with accepted/blocked axes, solver diagnostics, stamp, and `previewOnly: true`. Transient probe entities are excluded from returned geometry; conflicted source or numerical failure produces null geometry.

This projection is valid for the current independent-axis *linear* constraints only. It does not calculate a global least-motion solution for all sketch entities, and its geometry is not exact CAD or a committed design edit. Consumers must write intentional edits through the model journal, not persist preview geometry.

Executed developer commands: `node --test packages/sketch/test/drag-projection.test.mjs`; `tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 packages/sketch/test/drag-projection-contract.mts`.

Research disposition: ADOPT this reversible preview helper pending browser/UX testing. DEFER generalized nonlinear nullspace projection and PlaneGCS pending pinned executable benchmarks and licensing review.
