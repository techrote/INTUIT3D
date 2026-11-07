# Selected linear-profile hole authoring — v1

**Public contract:** \`@intuit3d/sketch/selected-profile-hole-authoring/v1\`.
This consumes the same explicit solved contour selection as
\`@intuit3d/sketch/selected-profile/v1\` and shares semantic hole IDs and
solver constraints with \`selected-profile-handles/v1\`.

\`inspectSelectedProfileHoleAuthoring(sketch,selection)\` exposes boundary
vertex and hole-centre reference anchors, selected hole locations/radii,
constraint IDs, and whether removal/reanchoring is currently safe. All
coordinates are millimetres, solver-derived. It refuses unsolved, ambiguous,
stale or unadmitted selections.

\`editSelectedProfileHole(sketch,selection,command)\` takes a
\`sourceSignature\`-fenced atomic command:

- \`add-hole\`: explicit \`holeId\`, \`anchorPointId\`, \`xMm\`, \`yMm\`,
  \`radiusMm\`; writes authored X/Y relative constraints and a radius
  dimension. Existing \`moveSelectedProfileHoleCenter\` and
  \`editSelectedProfileHandle\` immediately handle the added hole.
- \`reanchor-hole\`: changes which selected solved vertex or existing hole
  centre controls a hole's X/Y offsets while preserving its physical centre.
  Subsequent retrospective dimension edits follow the *new* anchor.
- \`remove-hole\`: removes the selected circle, its owned centre and
  dimensions only if no other authored geometry/constraint depends on it.

A success returns one *replacement* \`sketch\`, updated \`selection\`,
\`nextSourceSignature\`, solved and re-admitted \`profile\`, stable outer
\`semanticProfileId\`, and edited constraints. The consumer must journal
this as **one** undoable authoritative transaction. A refusal contains no
replacement source and never relaxes any constraint, deletes dependent
intent, or invents native geometry.

RUNTIME/WORKBENCH: inspect anchors, display add/remove/reanchor controls,
commit only accepted replacement sketches through INTENT/RUNTIME; refresh
native extrusion and cut dependencies from the new source revision.
\`previewOnly:true\`, \`nativeExact:false\` and
\`independentStepQualified:false\` remain mandatory until separate real
provider execution and external STEP acceptance.

Run \`node packages/sketch/examples/selected-profile-hole-authoring.mjs\`.
The fixture adds a third L-bracket hole, changes width 120→150 mm,
reanchors it, saves/reopens, removes it and checks undo source.
