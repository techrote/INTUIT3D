# Equal-pitch tangent round-slot arrays — v1

Public import: @intuit3d/sketch/selected-edge-round-slot-pattern/v1.

A directly editable array of 2–8 true semicircular tangent-ended slots on ONE
explicitly selected, axis-constrained contour edge. It is a durable **pattern
source**, not an array of unrelated independently re-sizable slot copies or
faceted preview geometry. All slots compile through the admitted nonlinear
multi-slot solver and one global analytic profile/intersection/hole-clearance
guard. Original linear sketch constraints and profile membership stay intact.

The source-authored pattern has {id,edgeId,count,firstCenterMm,pitchMm,widthMm,
straightDepthMm}; the first centre and pitch are measured along the ORIGINAL
selected edge start/tangent. Positive pitch must exceed width, and every
generated slot must be inside the edge and globally geometrically admissible.
The per-slot IDs are stable: id:repeat:0 through id:repeat:count-1. Changing
count adds/removes only trailing IDs and is one atomic edit; deleting an
instance does not automatically close gaps or heal the user's design.

Commands:

- createSelectedEdgeRoundSlotPattern(source,selection,{kind:
  'create-selected-edge-round-slot-pattern',version:1,sourceSignature,pattern})
- editSelectedEdgeRoundSlotPattern(authoring,{kind:
  'edit-selected-edge-round-slot-pattern',version:1,sourceSignature,count,
  firstCenterMm,pitchMm,widthMm,straightDepthMm})
- relocateSelectedEdgeRoundSlotPattern(authoring,{kind:
  'relocate-selected-edge-round-slot-pattern',version:1,sourceSignature,
  edgeId,firstCenterMm,pitchMm,widthMm,straightDepthMm})
- dragSelectedEdgeRoundSlotPatternHandle(authoring,
  {version:1,sourceSignature,handleId,target:{x,y}})
- rebaseSelectedEdgeRoundSlotPattern(authoring,newSource,newSelection,
  {kind:'rebase-selected-edge-round-slot-pattern',version:1,sourceSignature})
- inspect / serialize / parseSelectedEdgeRoundSlotPattern for archive/replay.

Four semantic handles are origin (rigid translate), pitch (second centre,
first fixed), width (symmetric about every centre), and depth (straight wall).
Pointer movement is projected via the accepted single-slot drag mathematics,
then the WHOLE pattern is recompiled and validated atomically. Refusal returns
a typed reason and never mutates the original envelope. A source revision
signature fences every command. An explicit rebase preserves the original
boundary edge and point references or refuses; relocation is a deliberate
typed edit, never an inferred replacement.

WORKBENCH should persist the complete versioned envelope in a revision-fenced
RUNTIME event, not the derived ArcSketch. Display valid dimensions, handle
positions, slot IDs and refusal reason. The compiled analytic arc sketch and
profile are consumer views with previewOnly=true, nativeExact=false. Physical
OCCT8 cuts, independent STEP verification, browser gestures and journal
integration are OUT OF SCOPE and must be separately qualified.

Executable consumer:

    node packages/sketch/examples/selected-edge-round-slot-pattern.mjs
    node --test packages/sketch/test/selected-edge-round-slot-pattern.test.mjs
    npm run typecheck --workspace=@intuit3d/sketch
    npm test --workspace=@intuit3d/sketch
