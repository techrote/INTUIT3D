# Interactive selected-profile dimension handles — v1

`@intuit3d/sketch/selected-profile-handles/v1` converts a solved, explicitly
selected linear-loop profile into semantic, revision-fenced controls. The
consumer displays `controls[].anchor` and `controls[].position`, then sends
`set-dimension` or a completed `drag-handle` with that source signature.
Every gesture produces **one replacement authored sketch and a new selection**
only when re-solving and fresh profile admission succeed.

Controls are built from real authored `distanceX`, `distanceY` and circular
`radius` constraints. They are not independent browser-side dimensions.
The returned sketch can enter the existing RUNTIME/INTENT journal transaction;
the selected profile keeps semantic `candidateId` and hole/edge IDs. RUNTIME
owns journal commit, undo, dependency rebuild and exact-provider execution.
No browser-side or external STEP correctness is implied.

Refusals are non-mutating and explicit for stale source, unauthorized handles,
unresolved constraints and invalid resulting profile (including a hole crossing
the selected boundary). A current-source solved profile is required even for
preview inspection; contradictory or underconstrained source is not silently
"fixed" to admit the edit.

```sh
node packages/sketch/examples/selected-profile-handles.mjs
npm test --workspace @intuit3d/sketch
npm run typecheck --workspace @intuit3d/sketch
```

Integration: WORKBENCH can offer these handles on the selected L-shaped
outline and holes; RUNTIME may commit the returned authored sketch through
its existing revision-fenced authority. KERNEL's pinned C++ and independent
non-OCCT STEP remain separate physical qualification gates.


## Atomic XY hole-centre drag on selected L-profiles
//
`inspectSelectedProfileHandles(...).holeCenters` reports solver-derived
selected circular centres only where exactly one authored X and one authored
Y distance relation binds that centre. Use
`moveSelectedProfileHoleCenter(sketch,selection,{kind:'move-hole-center',sourceSignature,handleId,xMm,yMm})`
for a completed 2D pointer gesture or precise XY inspector edit. This
applies BOTH authored constraints before re-solving and re-admitting the
selected profile, so an invalid temporary intermediate position is never
committed. The result supplies a replacement sketch, refreshed selection,
actual applied point, both modified constraint IDs, and stable hole/profile
semantics. Stale input, invalid target and boundary/overlap violations
refuse without mutating the project. No native or STEP assertion is made.
//
```sh
node packages/sketch/examples/selected-profile-hole-drag.mjs
node --test packages/sketch/test/selected-profile-handles.test.mjs
```
