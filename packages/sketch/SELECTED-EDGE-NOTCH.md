# Selected contour edge-notch authoring v1

**Contract:** \`@intuit3d/sketch/selected-edge-notch/v1\`.

A **sharp rectangular notch** is cut from a chosen straight, horizontal/vertical-constraint-backed boundary edge of a genuinely selected, solver-admitted plate contour. This is not a faceted replacement for the existing tangent-arc \`obround-slot/v1\`. Source is the ordinary editable constraint sketch (line/point primitives). No new document format, approximation, tolerance widening or hidden adapter state.

- \`createSelectedEdgeNotch(source,selection,{kind:'create-edge-notch',version:1,sourceSignature,notchId,edgeId,fromMm,toMm,depthMm})\` constructs four new stable points and four new stable lines. The original selected edge ID is **retained** as the first shortened segment. All eight new signed XY dimensional constraints reference the original semantic start point. A ninth, explicit horizontal/vertical constraint binds the surviving far-end segment to the original axis; otherwise shortening the original edge would release one of its former endpoints and introduce a free degree of freedom.
- \`inspectSelectedEdgeNotch(source,selection,notchId)\` replays real selected geometry, authored constraints and the three stable handle IDs (\`from\`, \`to\`, \`depth\`). It reconstructs after serialization/reopen and retrospective source changes.
- \`editSelectedEdgeNotch(...,{kind:'edit-edge-notch',version:1,sourceSignature,notchId,fromMm,toMm,depthMm})\` proposes one immutable dimensional replacement. \`dragSelectedEdgeNotchHandle(...,{version:1,sourceSignature,notchId,handleId,target:{x,y}})\` projects one pointer move to a genuine dimension and reports the actual applied point and projection deviation.
- \`selection\` is the source-fenced \`{candidateId,sourceSignature}\` from \`selected-profile/v1\`. Topology changes the derived candidate ID, so the acceptance **explicitly returns the successor selection**; consumers must journal both in one revision-fenced event and never infer stable candidate IDs across a trim. Stable authored line/point/constraint and notch IDs remain stable.
- Rejects stale commands, unknown/unselected/sloped edges, collapsing geometry, duplicated IDs, unsolved sources, profile self-contact, hole loss, or changed unrelated contours. All refusal paths preserve the input. Genuine circular holes on the contour remain selected, never silently dropped. Existing unrelated constraints remain intact.

The exact solver may report redundant constraints from the original horizontal/vertical boundary rule plus authored zero-offset vertex dimensions; no original relation is silently deleted. Only a fully solved and admitted contour is returned. The analytic profile is **preview-only**, never an OCCT B-rep or STEP proof.

## Executable acceptance

\`\`\`sh
node --test packages/sketch/test/selected-edge-notch.test.mjs
node packages/sketch/examples/selected-edge-notch.mjs
npm run typecheck --workspace=@intuit3d/sketch
npm test --workspace=@intuit3d/sketch
\`\`\`

WORKBENCH projects the pointer target into mm XY; RUNTIME commits the returned \`sketch\` **and** \`selection\` atomically to the selected-profile journal with a source revision fence. Neither downstream package is modified here. Native OCCT cut, saved runtime journal, Firefox/Chromium pointer execution, external STEP interoperability and physical qualification require separate independent evidence.
