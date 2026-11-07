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

## Authoritative curved-corner drawing (new)

`createRoundedPlateSheet({projectJson,sketchFeatureId,profileId,title,drawingId})` consumes the **same saved INTENT sketch feature** as the straight-plate drawing, now with a second authoritative payload key `roundedPlateIntent`: the exact JSON from `serializeRoundedPlateIntent` in accepted `packages/sketch/rounded-plate.mjs` (v1). The source sketch must be an actual solved two-hole `createCenteredHolePlate`, and the SKETCH fillet must be analytically admitted. This is a deliberate narrow v1 adapter, not an arbitrary fillet importer.

- Four authentic SKETCH right-angle fillets are drawn as eight alternating SVG `L`/`A` line/arc segments, not approximated or bridged by a sharp-corner polygon. The SVG y-axis reversal is accounted for in arc sweep flags.
- Returns the **actual analytic rounded material area**, four stable curve IDs plus corner IDs, individual line/arc lengths, total perimeter and the fillet radius; outer dimensions and hole offsets are taken from the unchanged authoritative solved sketch.
- A changed corner radius, width or hole geometry must be committed to the INTENT journal; the sheet is recomputed against that revision, and its original sketch signature and fillet-intent signature are retained in measurement provenance.
- Fillet radius, perimeter, overall dimensions, hole centre marks and hole table are annotated; SVG remains physical A3 with an explicit scale. All geometric claims stay `analytic_sketch_only` and `nativeExact:false`.

Run the complete authentic-project example:

```sh
node --experimental-strip-types packages/engineering/examples/create-rounded-plate.mjs ./rounded-plate.svg
```

The example creates a real INTENT+SKETCH project with R8 source fillets, changes width 120→150 mm and fillet radius R8→R12, commits the edit, saves and reopens the authoritative project, then generates the updated curved SVG. The source project must contain the fillet intent; missing, structurally invalid or geometrically unadmitted fillets are rejected rather than silently drawn as sharp corners. Variable per-corner v2 fillets and arbitrary profiled sections are not yet part of this narrow drawing API.

**Consumer integration request:** WORKBENCH can offer a 'Dimensioned drawing (rounded)' action for a selected saved sketch when `payload.roundedPlateIntent` is present, presenting `createRoundedPlateSheet(...).svg` and the perimeter/curve table as strictly derived inspection. INTEGRATION alone changes root lockfile, lane registration and shared CI. This implementation PR never writes those shared paths.
