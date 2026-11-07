# Selected linear hole pattern v1

A versioned authoring adapter for a **selected, fully solved linear sketch contour**:
`@intuit3d/sketch/selected-linear-hole-pattern/v1`.

The direct user action **create 2–12 holes → edit count/pitch/radius → move original sketch dimensions → remove** changes one immutable sketch revision per gesture, using source signatures and persistent semantic entity IDs. Each hole owns two signed dimensional constraints and one radius constraint. After the first hole is dimensioned relative to a selected boundary corner or an existing hole centre, later hole centres reference their immediate predecessor. A parent width/height edit therefore moves the pattern without destroying original feature intent.

The public `editSelectedLinearHolePattern(sketch, selection, command)` accepts
`create-pattern`, `set-pattern` and `remove-pattern`. `inspectSelectedLinearHolePattern` provides the authored constraints, count, spacing, radius, source revision and solved positions required by WORKBENCH. No browser authority or parallel design history is introduced. Editing/reducing a pattern refuses third-party dependent constraints; failed edits return no partial sketch. Existing selected-hole commands can be used for authoring unrelated holes which reference a pattern centre.

Example:

```bash
node packages/sketch/examples/selected-linear-hole-pattern.mjs
node --test packages/sketch/test/selected-linear-hole-pattern.test.mjs
npm run typecheck --workspace @intuit3d/sketch
```

The representative L-bracket starts with two holes, adds two linked radius-3 holes at (52,15) and (66,15) mm, changes to three radius-4 holes with 12 mm pitch, changes the upstream width 120→150 mm, and reopens the saved sketch with pattern centres (82,15), (94,15), (106,15). All semantic IDs persist. The tests cover conflicts with existing holes/boundaries, stale revision, invalid dimensions, full dependency-safe removal and under/overconstraint refusal.

These are **solver-authored analytic 2D sketch profiles only** (`previewOnly: true`, `nativeExact: false`). This tool never claims compiled native Boolean execution, STEP interoperability, real browser manipulators or Windows/Firefox testing. RUNTIME and WORKBENCH should pass the entire accepted replacement sketch through their existing authoritative journal/rebuild contracts, not commit intermediate hole edits.
