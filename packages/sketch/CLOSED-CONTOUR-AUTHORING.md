# Directly authored closed polygon contours (v1)

**Public typed API:** \`@intuit3d/sketch/closed-contour-authoring/v1\`

A user can click 3–12 points in sketch-local millimetres, choose **Close contour**, select the resulting *real solver-admitted* analytic profile, and drag its semantic vertices. Unlike a pre-defined rectangle or L-profile fixture, this authors a new independent closed cycle of typed points, edges, fixed datum and two signed dimensional constraints for every subsequent vertex. There is no hidden per-session geometry model.

- \`createClosedContour(doc,{kind:'create-closed-contour',version:1,sourceSignature,contourId,vertices})\` validates the complete cycle atomically. Stable IDs are \`contourId:vertex:N\`, \`contourId:edge:N\`, \`contourId:offsetX:N\`, \`contourId:offsetY:N\`, \`contourId:anchor\`.
- \`inspectClosedContour(doc,selection,contourId)\` reconstructs all coordinates, signed dimensions, and handles \`contourId:handle:N\` *from the serialized sketch*, with the real selected profile and original hole membership.
- \`editClosedContourVertices\` accepts a bounded batch of explicit sketch-local X/Y edits. The origin handle translates the polygon while preserving existing signed offsets; all other handles change two real dimensional constraints relative to the datum.
- \`dragClosedContourVertex\` applies one pointer-position edit, returning requested/applied XY and deviation; the caller must not persist mere transient pointer picks.

All outputs are source-stamped and revision-fenced. Source under/overconstraint, self-crossing, collinear/zero-area loops, touching/nested/crossing separate contours, newly contacting circular holes, changed hole ownership, invalid/colliding semantic IDs and stale commands refuse **without mutation**. Every proposed source is solved and passed through the real analytic profile discovery and selected-contour admission, including other existing profiles and holes. No synthetic approximate edge repair or tolerance inflation.

**Actual consumer sequence:** WORKBENCH converts pointer screen coordinates into sketch-local mm and collects the 3–12 intended vertices, then calls \`createClosedContour\` on the authoritative sketch. It renders \`handles[]\` and persists the returned \`sketch\` + \`selection\` as *one revision-fenced undoable RUNTIME transaction*, committing only \`accepted\`. Subsequent drags use \`dragClosedContourVertex\`, and reopening calls \`inspectClosedContour\` to recreate the handles. RUNTIME must fence its own project/journal revision **in addition** to the sketch source signature; neither package may infer a target solid or body from pointer hits. The accepted browser currently does **not** offer this new drawing mode: integration must wire it, not presume it exists.

This contract supplies analytic solved sketch intent only (\`previewOnly:true\`, \`nativeExact:false\`, \`independentStepQualified:false\`). Selected straight-edge native C++ support has separately bounded vertex/hole/shape conditions. Arbitrary custom polygons, their Booleans and STEP must be explicitly accepted by the pinned provider and independent STEP path before being called physical geometry.

Example: \`node packages/sketch/examples/closed-contour-authoring.mjs\`
Tests: \`node --test packages/sketch/test/closed-contour-authoring.test.mjs\`

## Associative hole centres during vertex editing

A constrained, selected circular hole made with
`@intuit3d/sketch/selected-profile-hole-authoring/v1` can be dimensioned
relative to a newly authored polygon vertex, or to another selected hole
centre. On a subsequent `dragClosedContourVertex` or
`editClosedContourVertices`, the real solver carries this dependency through
the edit. The accepted result's additive `movedDependentHoles[]` reports
the semantic hole IDs, centre IDs, and previous/current millimetre coordinates.

Only hole centres belonging to the selected contour and reached through an
unchanged, unique pair of authored distanceX/distanceY reference constraints
are admitted as moved dependents; chains are explicitly traversed. Unrelated
dependent points and ambiguous/unconstrained hole-centre references remain
blocked. The full resultant profile and circular clearance are re-admitted
atomically. A hole contacting or escaping the boundary refuses the gesture
without modifying the source. This is an analytic preview contract, **not**
a newly qualified native pocket/cut or independent STEP feature.

**Reproduce:** `node --test packages/sketch/test/closed-contour-authoring.test.mjs`
and `node packages/sketch/examples/closed-contour-authoring.mjs`.
WORKBENCH renders `movedDependentHoles[]` only after RUNTIME atomically
journals the accepted replacement sketch and successor selection, with its
own project/session revision fence; no cross-lane source changes here.
