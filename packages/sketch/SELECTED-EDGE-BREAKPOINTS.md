# Dimensioned selected-contour edge breakpoints (v1)

**Public API:** `@intuit3d/sketch/selected-edge-breakpoints/v1`.

An independently selected, already solved profile edge can be subdivided into one
to eight **real solver-constrained vertices** without changing the profile
area, holes or original semantic edge ID. Unlike the existing notch, chamfer
and tangent-slot APIs, this operation introduces selectable *reference
subedges* without changing the material boundary. It is useful for dimensioned
mounting datums and subsequent edge-specific authoring.

The commands `createSelectedEdgeBreakpoints`,
`inspectSelectedEdgeBreakpoints`, `editSelectedEdgeBreakpoints`,
`dragSelectedEdgeBreakpoint` and `removeSelectedEdgeBreakpoints` accept
an explicit selected-profile token and serialized sketch revision signature.
Creation uses `{kind:'create-edge-breakpoints',version:1,sourceSignature,
splitId,edgeId,offsetsMm:[30,60]}`. Offsets are **strictly increasing**
positive signed distances along the selected boundary direction and strictly
inside the original edge. The original line ID remains the first segment;
later line IDs are `splitId:segment1`, etc. The additional segments have
real axis constraints. Each offset has a signed distanceX or distanceY
constraint against the original semantic start vertex.

Dragging a semantic `splitId:handleN` projects the pointer onto the original
edge axis and edits the appropriate dimension. Unlike mutating seed
coordinates, the full selected contour is re-solved and independently
re-admitted. Each accepted operation returns **both** the new authoritative
sketch **and** the replacement selection token. RUNTIME must commit them
atomically in one revision-fenced undo/redo journal event; WORKBENCH must
use this token for subsequent pointer commands and display refusal reasons.

Creation, editing and removal refuse stale revisions, inconsistent or
unsolved sketches, unsupported non-axis-constrained edges, ordering changes,
collapsed segments, semantic-ID collisions, reference-dependent removal,
and unselected-geometry drift. No operation silently drops an authored
constraint. Saved sketches alone reconstruct the breakpoint state on reopen;
there is no hidden mutable adapter state.

**Not covered:** splitting arbitrary diagonal/curved edges, modifying arc
tangency, actual boundary trimming, kernel-generated B-rep topology, physical
OCCT cutting, STEP interoperability or tested Firefox pointer gestures.
The output is analytic preview intent and explicitly reports
`nativeExact:false`.

Runnable demonstration:
`node packages/sketch/examples/selected-edge-breakpoints.mjs`.
