# Associative selected-edge datum projection (v1)

**Public, versioned ESM/TypeScript export:** `@intuit3d/sketch/selected-edge-projection/v1`

This extends the accepted `selected-edge-breakpoints/v1` operation with an
**associative perpendicular reference between two parallel selected contour
edges**. Given 1–8 existing, fully constrained source breakpoints, the operation
creates genuine target boundary vertices, retaining the original target edge ID.
Each projected vertex has a source-bound zero `distanceX`/`distanceY`
constraint and an axis-constrained new target segment. It is not an overlay,
snap suggestion, polygonal approximation or ephemeral coordinate copy.

The API exports:

- `createSelectedEdgeProjection(source, selection, {kind:'create-edge-projection', version:1, sourceSignature, projectionId, sourceSplitId, targetEdgeId})`
- `inspectSelectedEdgeProjection(source, selection, projectionId, sourceSplitId)`
- `editSelectedEdgeProjection(source, selection, {kind:'edit-edge-projection',version:1,sourceSignature,projectionId,sourceSplitId,sourceOffsetsMm})`
- `dragSelectedEdgeProjection(source, selection, {version:1,sourceSignature,projectionId,sourceSplitId,handleId,target:{x,y}})`
- `removeSelectedEdgeProjection(source, selection, {kind:'remove-edge-projection',version:1,sourceSignature,projectionId,sourceSplitId})`

The selected contour and every commanded edit are re-solved and re-admitted.
A non-axis-constrained, non-parallel, coincident, out-of-range or overlapping
target refuses without mutation. The target may be oppositely oriented:
association identity comes from the source breakpoint semantic point, not
target array index. For a default L profile, two datums on bottom `L:edge0`
at 55 and 75 mm project onto the inward-facing `L:edge2` at target offsets
45 and 65 mm, respectively (reverse association order).

`inspect` reconstructs source-to-target associations from the serialized
constraints, with no hidden adapter state. Retrospective L-length changes
preserve the aligned coordinates. Editing or dragging a projected handle
edits the **driving source dimension** and its constrained projection in one
transaction; it never silently relaxes the corresponding zero-offset
constraint. Removing the projection refuses if foreign geometry or constraints
depend on target vertices. It leaves the original driving source datums intact.

**Consumer integration:** WORKBENCH must select the actual discovered contour,
use the `projectionId:handleN` semantic handles for pointer gestures and
display refusal reasons. RUNTIME must journal the returned `sketch` and the
returned **successor** `selection` as one revision-fenced command. Do not
reuse the predecessor candidate token after changing contour segments.
`sourceSignature` is the serialized authoritative sketch, not a canvas
timestamp or a native-topology reference.

The code returns `previewOnly:true`, `nativeExact:false` and
`independentStepQualified:false`. Only axis-parallel line edges are supported;
general angular/curved projections, actual trimming/removing material, native
OCCT8 cutting, STEP parity and Firefox/Windows graphical interaction are not
claimed. The operation is a substantive reference-driven sketch authoring
primitive, not a B-rep face projection.

Run the authored consumer:
`node packages/sketch/examples/selected-edge-projection.mjs`.

Run tests:
`npm --prefix packages/sketch test` and
`npm --prefix packages/sketch run typecheck`.
