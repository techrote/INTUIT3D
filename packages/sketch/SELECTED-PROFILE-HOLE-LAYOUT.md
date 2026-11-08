# Selected-profile atomic hole layout and reference rebinding

**Public contract:** `@intuit3d/sketch/selected-profile-hole-layout/v1`.

`inspectSelectedProfileHoleLayout(source, selection)` returns selected holes,
solver-resolved centres/radii, dimension constraint IDs and semantic references.
A completed inspector/pointer batch invokes `editSelectedProfileHoleLayout`
with `{kind:'set-hole-layout',sourceSignature,edits}`. Each requested edit
has `{holeId,xMm,yMm,radiusMm}` and may supply an explicit
`anchorPointId` for a selected boundary vertex or selected hole centre.
Providing it rebinds both authored X/Y axis references and recomputes signed
offsets in **one** source revision with coordinate/radius changes. Omission
retains original references: the tool never silently changes design intent.

Edited parent holes serve as simultaneous future anchors. After solving and
strict selected-profile admission, all explicit targets must match. Refusals
for stale input, foreign/self reference, unsolved or conflicting geometry,
boundary contact, overlap or changed selected identity return **no sketch**.
An accepted result includes `changedConstraintIds`, `reanchoredHoleIds`,
`affectedHoleIds` and effective per-axis references/offsets for journaling.

```sh
node packages/sketch/examples/selected-profile-hole-layout.mjs
node --test packages/sketch/test/selected-profile-hole-layout.test.mjs
npm test --workspace @intuit3d/sketch
npm run typecheck --workspace @intuit3d/sketch
```

The demo atomically swaps two L-profile holes and radii, deliberately
rebinds the upper-web hole to the stable origin, widens the profile, and
reopens the solved authoring source. Restoring a serialized source snapshot
does not prove an INTENT/RUNTIME journal undo. This contract is analytic
only, not a native solid, STEP cut or browser interaction.
