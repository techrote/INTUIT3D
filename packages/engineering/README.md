# @intuit3d/engineering — dimensioned sheet v1

A real, derived **A3 landscape SVG top-view drawing** from an INTUIT3D authoritative **INTENT project journal** containing a supported, fully constrained **SKETCH centered-hole plate**. Supported source format (v1): a ready \`kind:'sketch'\` feature with a \`payload.sketchDocument\` holding the SKETCH v1 JSON serialization. The supported profile adapter is \`inspectCenteredHolePlate\`, not arbitrary B-rep, meshes or unknown sketch contours.

\`measurePlateFromProject({projectJson,sketchFeatureId,profileId})\` independently asks the accepted INTENT and SKETCH packages to validate/replay the project, solve, check profile hole clearance and compute the 2D profile; it returns measured width, height, two stable hole IDs/centres/diameters, pitch, area and original project revision/source signature. \`renderPlateDrawingSvg(measurement,{title,drawingId})\` creates a fully local deterministic SVG with real-scale outlines, centre marks, dimensions, labelled holes, A3 border and title block. \`createDimensionedPlateSheet\` is the one-call consumer adapter (returns \`{measurement,svg,mimeType,filename}\` for preview or a local SVG download).

**Every measurement is \`analytic_sketch_only\`. No sheet claims 3D thickness, B-rep topology, exact native Boolean, certified STEP or independent external CAD acceptance.** The A3 sheet is scaled down only when a large profile cannot fit; the explicit scale is shown. Units are millimetres.

## Executed package checks

\`\`\`sh
node --experimental-strip-types --test packages/engineering/test/*.test.mjs
npm run test --workspace @intuit3d/engineering
npm run typecheck --workspace @intuit3d/engineering
\`\`\`

The actual integration root already glob-registers \`packages/*\` workspaces. INTEGRATION owns root lockfile/CI mutations, guarded merges and browser wiring. This package changes **only** \`packages/engineering/**\`.

## Concrete consumer interface

1. Create/restore a \`@intuit3d/model\` project; attach \`serializeSketch(sketch)\` as the stable sketch feature's \`payload.sketchDocument\` (the journal remains authoritative).
2. Pass \`serializeProject(project)\`, its ready sketch feature ID, and the centered-hole plate profile ID to \`createDimensionedPlateSheet\`.
3. WORKBENCH can display \`svg\` as a derived preview and offer \`image/svg+xml\` download. After a sketch dimension change, commit a new INTENT feature edit containing the updated serialized SKETCH (do not save derived SVG as authoritative); regenerate against the new project revision.
4. INTEGRATION: admit this package to root CI and wire the existing actual saved-project/selected-sketch UI; provide real browser SVG preview/download. No root/UX changes are made by this owner.

**Deliberate limit:** no generic arc/fillet profile drawing, imported STEP geometry, tolerance language, projected sections or mass properties yet. Those need accepted source geometry contracts and physical qualification. This is a usable first engineering sheet, not a fabrication certificate.
