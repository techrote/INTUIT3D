# Rectangular hole grid / targeted body v1

`@intuit3d/feature-ops/rectangular-hole-grid/v1` exports
`authorRectangularHoleGrid(history, request, {runtime,model})` and
`resizeRectangularHoleGrid(history, request, {runtime,model,sketch})`.
Both are versioned, revision/project-fenced, explicitly `mm`/`local_xy`, and
bind the selected solved SKETCH circle to one named extrusion, cut and body.
They refuse ambiguous body writers and stale/invalid input before invoking
RUNTIME. No independent geometric predicate, model journal or kernel is added.

**Create:** 1–8 columns and rows, 2–32 total holes. The selected hole is
`r0c0` and remains unchanged. RUNTIME's existing `patternPlateHoles` reads
its actual solved center and radius; newly authored independent circles have
stable IDs `<prefix>:r<Row>c<Column>`. SKETCH performs actual profile
admission. An invalid overlap or off-material grid is a *noncommitting refusal*.

**Resize:** explicitly target exactly those IDs and source circle; compute the
pivot from current solved SKETCH source center and delegate positive X/Y
scale factors and an optional independent radius multiplier to RUNTIME's
`resizePlateHoleLayout`. One undo step preserves all circle identities and
unrelated bodies. A missing grid cell refuses instead of recreating it.
The resize does not establish, persist or maintain an *associative pattern*
constraint: copied holes may be independently edited, and the command scales
the current selected locations; it does not certify their previous pitch.

Run a real mechanical-part consumer:

```sh
npm ci
npm test --workspace @intuit3d/feature-ops
node --experimental-strip-types packages/feature-ops/examples/fixture-plate-grid.mjs
```

That example constructs a **160 × 100 × 8 mm** fixture plate and independent
spacer using accepted INTENT, SKETCH and RUNTIME, authors a 4 × 3 hole grid
with 40/30 mm pitches, retrospectively scales copy spacing to 0.75×/1.2×,
undoes/redoes, edits plate thickness 8 → 12 mm and saves/reopens. Negative
tests cover stale revisions, wrong body, collisions, malformed layouts,
missing copies, unusable solver, invalid RUNTIME results and lack of dependent
invalidation. All output remains `pending_exact_provider`; no new B-rep/STEP
or production OCCT/interchange acceptance is claimed.

**WORKBENCH handoff:** add Cut → Rectangular Pattern with explicit selected
circle, selected body/extrude/cut, rows/columns, pitch X/Y, prefix and revision;
add a separately labelled one-shot Resize Grid Copies control requiring the
same source/IDs plus X/Y/radius factors. Inspect `kind==='refused'` and display
unmodified document status. Never imply linked pattern constraints or physical
STEP until KERNEL/RUNTIME actually qualify the solid.

**INTEGRATION:** qualify the exact source SHA including tests and real Node
consumer; only Integration may merge. Existing root workspace registration
already exposes this package, so only an additive package subpath export is
required here. No shared CI/lockfile edits are requested.
