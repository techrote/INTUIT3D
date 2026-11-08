# Selected contour notch, version 1

**Public consumer API:** \`@intuit3d/feature-ops/selected-contour-notch/v1\`.
**Source ownership:** \`packages/feature-ops/**\`; additive export only.

A user selects a saved, solved SKETCH profile, one named dimensioned orthogonal boundary edge, and the extrusion/body created from that sketch. \`authorSelectedContourNotch\` trims a sharp rectangular relief into the actual constrained contour. \`editSelectedContourNotch\` changes its three dimensions retrospectively; \`dragSelectedContourNotch\` applies a real named depth/edge handle drag. No duplicate solver, topology, model journal, hidden geometry or inferred body selection is introduced.

Each request supplies \`format\`, \`version\`, project/revision fence, event ID, explicit \`mm\`/\`local_xy\`, \`sourceSketchId\`, \`extrudeFeatureId\`, \`targetBodyId\`, \`selection:{candidateId,sourceSignature}\`, and \`notchId\`. Creation additionally supplies \`edgeId,fromMm,toMm,depthMm\`; dimension editing supplies the three dimensions; drag supplies \`handleId,target:{x,y}\` in millimetres. Only current selected SKETCH profiles that RUNTIME admits and named, matching extrusion targets may be edited.

The command calls the **accepted** \`@intuit3d/sketch/selected-edge-notch/v1\` functions and commits the returned exact analytic sketch plus **successor selected-profile ID and source signature in the same one-event RUNTIME transaction**, not via a separate transient in-browser store. Stable point/line/constraint IDs survive edits and archive replay. Undo/redo, dependency invalidation and archived revision are INTENT/RUNTIME-owned. Each result includes a named \`rebuild_selected_profile_body\` handoff; downstream native evaluation is not claimed.

Invalid/stale revision, sketch/profile selection, unmatched extrusion/body, missing edge/handle, sloped/unconstrained geometry, collapsing notch, duplicated entities, bad dimensions and no-op edits are refused before commit. A direct external rewrite of a selected source requires explicit reselection; this API will not reuse a stale source signature.

## Executable public part and tests

\`\`\`sh
npm ci
node --experimental-strip-types packages/feature-ops/examples/selected-contour-notch.mjs
npm test --workspace @intuit3d/feature-ops
npm run ci
\`\`\`

The example authors a dimensioned 120 mm two-hole L mounting arm, a separately profiled slot cutter, and an independent spacer; applies and dimension-edits the notch, drags its depth handle, undoes/redoes, reopens the archive, then changes arm thickness 10→14 mm while retaining the independent spacer. It reports affected feature IDs and native-provider-pending statuses.

**Authority:** SKETCH is exact about its own analytic constraints, not physically exact solid geometry. RUNTIME reports \`analytic_profile_only\` for the selected contour, \`preview_only\` for the extrusion and \`pending_exact_provider\` for the distinct slot cut. Neither the notch's new contour nor the slot is claimed to have executed pinned OCCT8, produced a physically validated STEP, or passed human graphical interaction. INTEGRATION owns exact-head CI and merge; WORKBENCH should expose selected contour edge, numeric notch inspector and three drag handles.
