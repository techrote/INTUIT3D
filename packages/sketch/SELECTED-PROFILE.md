# Selected line-loop profiles and dimensioned L plate — v1

**Purpose.** Choose one solved analytic profile from a sketch with multiple
distinct contours, rather than requiring every other closed loop to be erased
before a profile can be consumed by a future native extrude.

Use the public \`@intuit3d/sketch/selected-profile/v1\` export.
\`createDimensionedLPlateSketch\` creates an actual constrained six-segment
L-shaped plate sketch with two corner-relative holes. Its width, web width,
height, flange height, hole offsets and radii are **authored constraints**;
\`editConstraint\` updates the solver-dependent geometry without regenerating
IDs. \`discoverPlateProfiles\` identifies candidate loops and their stable
semantic line IDs. The user explicitly chooses a candidate, supplies its
source signature to \`proposeSelectedPlateProfile\`, and uses
\`admitSelectedPlateProfile\` for a fresh immutable recomputation.

The response includes ordered start/end vertices, analytic area, hole IDs,
unselected line IDs and stable semantic candidate identity. Its values can be
used to build a versioned selected-profile native request **after** KERNEL
defines that request. It is not a kernel implementation.

**Conservative boundary.** Every unselected line must have a strictly
separated axis-aligned bound from the chosen profile. Nested, touching,
crossing or even just bounding-box-overlapping other paths are refused,
rather than silently inferring material topology. This may reject some
physically separate diagonal contours; that is an explicit limitation, not
a reason to enlarge tolerances. Contradictory/underconstrained sketches and
stale/forged selection data refuse. Unrelated solved drafting lines outside
the selected bound are identified, not hidden.

**Evidence labels:** source and deterministic Node solver fixture only.
\`providerSubmissionReady:true\` means analytic geometry can be submitted to
a native provider; \`nativeExact:false\`, \`exactBrepAvailable:false\`, and
\`independentStepQualified:false\` remain mandatory. No OCCT8, browser or
independent CAD result is claimed.

Run from repo root:

\`\`\`sh
node packages/sketch/examples/selected-l-profile.mjs
node --test packages/sketch/test/selected-profile.test.mjs
npm run test --workspace @intuit3d/sketch
npm run typecheck --workspace @intuit3d/sketch
\`\`\`

**Consumer handoff:** WORKBENCH presents available candidates, highlights
chosen boundaries and excluded strokes. RUNTIME persists selected candidate
semantic ID and authoritative sketch source revision, rejects stale proposals
and requests targeted KERNEL native extrusion. KERNEL owns body selection
and physically validated STEP; selection alone is neither.
