# Centered-hole constrained plate v1

An additive, fully solved linear sketch contract for a rectangular plate and two circular holes. The new midpoint constraint binds a construction point to the actual left edge; each hole's Y is dimensioned from that midline, while X coordinates are dimensioned from opposite outer edges. Width or height changes propagate through real solver dependencies, retaining semantic IDs and saved intent.

Public import: `@intuit3d/sketch/centered-hole-plate/v1` with create, inspect, dimension-edit and pointer-drag APIs. Six stable handles expose width, height, two insets and two radii. A profile-invalid edit remains authored and recoverable without fabricating cut geometry. Revision fences prevent stale writes.

Run: `node packages/sketch/examples/centered-hole-plate.mjs`, `node --test packages/sketch/test/centered-hole-plate.test.mjs`, `npm run typecheck --workspace @intuit3d/sketch`.

Evidence boundary: solved 2D linear constraints and analytic polygon/circle area only. All outputs are explicitly preview-only; neither OCCT B-rep, browser interaction nor independent STEP execution was performed by this SKETCH change.
