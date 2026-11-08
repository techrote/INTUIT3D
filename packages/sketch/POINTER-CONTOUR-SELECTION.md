# Pointer-selectable solved contours (v1)

**Public consumer API:** `@intuit3d/sketch/pointer-contour-selection/v1`

## User workflow

1. WORKBENCH converts a stationary 2D pointer position into sketch-local millimetres. `inspectPointerSelectableContours(sketch)` lists all solved, separately admissible candidate contours, exposing blocked contour diagnostics rather than choosing a default.
2. `selectContourAtPointer(sketch,{kind:'select-contour-at-pointer',version:1,sourceSignature,point:{x,y},boundaryClearanceMm})` selects the genuinely hit material region. Circular holes are empty; boundary/near-boundary hits refuse with caller-specified clearance in mm (zero for exact hits). A miss does not invent a selection.
3. Feed the returned `{candidateId,sourceSignature}` directly to existing `inspectSelectedProfileHandles`, `editSelectedProfileHandle`, `setSelectedEdgeHoles` and selected-contour commands. Workbench must use the returned exact source stamp; never assume the first discovered contour.
4. `pickContourEdgeAtPointer(sketch,{kind:'pick-contour-edge-at-pointer',version:1,sourceSignature,point:{x,y},maxDistanceMm})` returns the actual authored edge ID, directed start/end point IDs, projected closest point, fractional position, along-edge mm and miss distance. Vertex ambiguity and multiple nearby edges refuse, rather than silently choosing an edge.
5. RUNTIME journals the actual replacement sketch and successor selection as one revision-fenced transaction when the user commits an edit. This pointer API is read-only and does not append journal events.

## Safety and scope

Only solved linear contours independently admitted by `selected-profile/v1` qualify. Distinct genuinely disjoint contours can be clicked separately even when their bounding boxes overlap (for example, an island in the empty upper-right cutaway of an L-profile). Exact dyadic polygon separation rejects crossings, touches, and either direction of nesting; open or rejected linework retains conservative AABB exclusion. Overlapping/nested unrelated contours, invalid geometry, stale signatures and under/overconstrained sketches are not implicitly repaired. No point-ID welding, topology inference or hidden tolerance widening occurs. Hit radii must come from WORKBENCH viewport-to-sketch conversion.

All results explicitly report `previewOnly:true`, `nativeExact:false`, `exactBrepAvailable:false`, `independentStepQualified:false`. This is a 2D analytic selection/authoring bridge, not native OCCT8 physical cutting, STEP parity or real browser gesture qualification.

## Executable consumer

```sh
node packages/sketch/examples/pointer-contour-selection.mjs
node packages/sketch/examples/concave-contour-pointer.mjs
npm --prefix packages/sketch test
npm --prefix packages/sketch run typecheck
```

**Integration handoff:** WORKBENCH owns actual pointer coordinate transformation, drag/click discrimination, and visual selection. RUNTIME owns journal fence and successor token. INTEGRATION owns independent acceptance and guarded merge. Actual Chromium/Firefox click acceptance and full #74 native/STEP workflow remain separate.

## Exact contour separation (additive boundary-guard/v1 contract)

`assessSeparatedPolygonBoundaries(outerA,outerB)` accepts two finite, already
simple closed polygon boundaries and returns `{version:1,status:'separated',reason:null}`
or `{version:1,status:'refused',reason:'invalid_boundary'|'boundary_contact'|'nested_contour'}`.
It compares encoded binary64 coordinates by exact dyadic intersections and two-way
point containment: AABB overlap alone neither proves intersection nor authorizes
implicit union/subtraction. This is a typed SKETCH analytic predicate, not
native geometry approval.

In the example, a separate rectangle at 62–82 × 42–60 mm sits entirely in the
L-profile's concave cutaway. WORKBENCH can click and pick edges on either
contour, edit the L length 120→150 mm, archive/reopen and reselect the island
without changing IDs. Its SVG-to-sketch coordinate transform and RUNTIME's
atomic journal remain integration responsibilities; native C++/STEP is separate.
