# Cut-block placement — FeatureOps v1

## User outcome

Select **2–16 contiguous cuts in the actual body dependency chain** (for
example the shaft bore and its counterbore), inspect paginated drop destinations,
and move the entire machining block without reversing its internal order.
One drag is one authoritative undo frame. The selection may have downstream
cross-body edge users, which are invalidated for rebuild instead of re-targeted
heuristically. This is mechanically distinct from moving an individual cut.

Public package export: \`@intuit3d/feature-ops/cut-block-placement/v1\`.
No separate graph solver, sketch solver or native Boolean is introduced.
The accepted \`@intuit3d/model/body-cut-block-relocate\` owns relocation
admission and compensating dependency rewires. RUNTIME owns status, replay
and downstream evaluation. Both APIs refuse absent/invalid semantic targets.

## Consumer flow

1. From the selected body and contiguous cut IDs, capture \`projectId\`,
   \`revision\`, \`model.serializeProject(document)\` as the canonical **fence**,
   \`units:'mm'\`, \`frame:'local_xy'\`. Never infer a body from viewport geometry.
2. Call \`inspectCutBlockPlacement(history,{format:CUT_BLOCK_PLACEMENT_FORMAT,
   version:1,expectedProjectId,expectedRevision,expectedDocumentFence,
   units:'mm',frame:'local_xy',targetBodyId,cutFeatureIds,offset:0,limit:16},
   {model,runtime,block})\`. Page through destinations using \`nextOffset\`;
   show \`current\`, \`available\`, and \`blocked\` with diagnostic.
3. To apply an explicitly chosen \`available\` anchor, pass the same fenced
   selection, \`afterBodyWriterId\`, returned \`writerOrder\`,
   \`cutSelections\`, and 2–3 **fresh** event IDs (the chosen row's
   \`requiredEventIds\`). Call \`moveCutBlock\`.
4. Replace session history with \`result.history\`; use
   \`result.invalidation\`, \`invalidatedBodyIds\`, \`statuses\` and
   \`nativeHandoff\` to schedule/label provider rebuild. For undo/redo use
   the existing RUNTIME journal lifecycle; save/reopen is unchanged.
   **Do not infer validated geometry from a ready semantic order**.

The snapshot fence rejects equal-revision divergent histories, and target
selection, source sketch, extents, frame, IDs and expected order are checked
before commit. Illegal named-edge placements are **blocked by INTENT**.
No preview mesh or old provider cache is promoted to current exact geometry.

Run executable consumer:

\`\`\`sh
node --experimental-strip-types packages/feature-ops/examples/servo-block-placement.mjs
npm test --workspace @intuit3d/feature-ops
npm run check:workspace
\`\`\`

This is **model-owned semantic CAD authoring**, not physical OCCT8/STEP
execution. Production native Boolean, independent non-OCCT readback and
graphical drag acceptance belong to separate Integration/WORKBENCH gates.
