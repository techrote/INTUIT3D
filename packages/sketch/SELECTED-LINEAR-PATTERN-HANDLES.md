# Selected linear pattern direct handles v1

Consumer contract: **@intuit3d/sketch/selected-linear-pattern-handles/v1**

Builds on the accepted selected-profile L-bracket linear-hole pattern, not a
parallel sketch solver or a browser-local geometry cache. The exported
' inspectSelectedLinearPatternHandles(sketch, selection, patternId) '
returns three stable semantic handles for a fully solved selected contour:

- **origin:** centre of first hole; a signed XY drag atomically edits its two
  authored anchor constraints. The rest of the pattern follows.
- **pitch:** second hole centre; the pointer target expresses the signed XY
  pitch relative to first centre, rewriting all linked pattern X/Y constraints
  in one edit.
- **radius:** point on the first hole circumference; radial distance
  atomically edits the common radius constraints on every member.

' dragSelectedLinearPatternHandle(sketch, selection, command) ' takes
'{kind:"drag-pattern-handle",sourceSignature,patternId,handleId,xMm,yMm}'.
Pointer values are in solved sketch millimetres. Return on success is one
immutable, validated replacement SKETCH document and selection with the new
source signature, changed constraint IDs, selected analytic profile and
applied-point deviation. The consumer journals the replacement **once**.
On stale, under-/overconstrained, colliding, unsolved or invalid requests it
returns a typed refusal **without a replacement sketch**. No auto-snapping,
constraint relaxation or invisible repair is performed. Count edits remain in
the established 'selected-linear-hole-pattern/v1' API.

Run from the repo root:

    node packages/sketch/examples/selected-linear-pattern-handles.mjs
    node --test packages/sketch/test/selected-linear-pattern-handles.test.mjs
    npm run typecheck --workspace @intuit3d/sketch

The representative workflow moves pattern spacing from 14 to 12 mm, increases
radius 3 to 4 mm, widens the parent L from 120 to 150 mm, saves/reopens and
verifies hole centres at (82,15) and (94,15) mm with stable identifiers.
Other tests cover origin drag, XY pitch, three-hole regeneration, stale edits,
collisions, nonfinite gestures and unsolved sources.

This is analytic SKETCH input and preview only, **not** an assertion of pinned
C++ Boolean execution, STEP interoperability, Firefox interaction or native
geometry acceptance. RUNTIME owns revision-safe journal integration,
WORKBENCH owns actual pointer integration, and INTEGRATION owns guarded merge.
