# Selected convex-corner chamfer authoring (v1)

**Public contract:** \`@intuit3d/sketch/selected-corner-chamfer/v1\`.

Chamfers a *real selected, fully solved linear sketch contour* at a convex, perpendicular, horizontal/vertical-constraint-backed vertex, with two independent signed setbacks. The original incoming/outgoing line IDs and all existing dimensions are preserved. The original semantic corner is kept as a reference datum; two new endpoints, one genuine new bevel segment and four signed X/Y dimensional constraints express the trim. This is a straight-edged chamfer, **not** a polygonal stand-in for a tangent arc or rounded slot.

- \`createSelectedCornerChamfer(doc, selection, {kind:'create-corner-chamfer',version:1,sourceSignature,chamferId,cornerPointId,incomingMm,outgoingMm})\` returns the replacement SKETCH and a **new selected-profile candidate ID and source signature**. The selection must name a discovered real contour.
- \`inspectSelectedCornerChamfer(doc,selection,chamferId)\` reconstructs the actual authored reference bindings, two dimensions, genuine solved profile and semantic handles after replay; it does not trust hidden adapter metadata.
- \`editSelectedCornerChamfer(...,{kind:'edit-corner-chamfer',version:1,sourceSignature,chamferId,incomingMm,outgoingMm})\` changes both constraints in one transaction. \`dragSelectedCornerChamferHandle(...,{version:1,sourceSignature,chamferId,handleId,target:{x,y}})\` projects a 2D pointer onto the corresponding signed-distance axis, reporting applied point and off-axis deviation.
- Only strict interior positive setbacks are allowed. Concave, sloped, shared/branching, unsupported or conflicting corners are **refused**, never silently approximated. Full solver replay, discovery, circular-hole membership and unselected-geometry isolation run on every proposal; failure leaves the original document unchanged. The source and successor selected-contour tokens must be committed **together** in RUNTIME's revision-fenced journal.

## Execute
\`\`\`bash
node --test packages/sketch/test/selected-corner-chamfer.test.mjs
node packages/sketch/examples/selected-corner-chamfer.mjs
npm test --workspace=@intuit3d/sketch
npm run typecheck --workspace=@intuit3d/sketch
\`\`\`

WORKBENCH maps two semantic grip points to \`dragSelectedCornerChamferHandle\`, displays refusal and projection distance and commits only accepted results via RUNTIME. Featureops may build a downstream body from the returned selected contour. No browser/runtime code is changed in this PR.

**Authority:** solved 2D linear SKETCH analytic preview; \`previewOnly:true\`, \`nativeExact:false\`, \`exactBrepAvailable:false\`, \`independentStepQualified:false\`. Neither source-matched OCCT C++ physical chamfer cutting nor independent STEP, app journal undo, Windows Firefox / Chromium pointer interaction is claimed by these tests. For true tangent-arc ends, the separately qualified nonlinear arc solver and independent kernel conversion are still required.
