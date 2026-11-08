# Machined body variant v1 — new body and full machining recipe in one action

Public API: @intuit3d/feature-ops/machined-body-variant/v1

Exports: MACHINED_VARIANT_FORMAT, MACHINED_VARIANT_VERSION,
inspectMachinedBodyVariant and createMachinedBodyVariant.

This is new-body authoring, not another recipe copy onto an existing body.
From any 2–8 consecutive machining cuts of a selected source body, the
engineer chooses an independently authored target extrusion SKETCH,
positive extrusion depth, and the SKETCH/extent for every new target pocket.
The operation creates a NEW semantic body, extrusion and 2–8 new cuts through
one authoritative RUNTIME/INTENT transaction and ONE undo frame.

The implementation composes the accepted profile-solid/v1, adapted-cut-recipe/v1
and cut-recipe-copy/v1 contracts on disposable histories, then atomically
commits the verified sequence against the original source history.
It never silently clones, relocates, transforms or heals SKETCH geometry.

## RUNTIME and WORKBENCH consumer gesture

1. New machined body from recipe: select the source body and any 2–8
   consecutive ordered cut IDs; select a solved target base SKETCH/profile,
   positive millimetre extrusion depth and new extrusion/body/event IDs.
2. Inspect using inspectMachinedBodyVariant(history, selection, services).
   Selection requires format MACHINED_VARIANT_FORMAT, version 1,
   expectedProjectId, expectedRevision, expectedDocumentFence from
   model.serializeProject(history.document), units mm, frame local_xy,
   sourceBodyId, sourceCutFeatureIds, baseSketchId, baseProfileCandidateId,
   depthMm, newExtrudeFeatureId, newBodyId and newExtrudeEventId.
3. Display the returned sourceCuts and complete sourceWriterOrder,
   including any later source cuts that will not be copied. Ask for one explicit
   target per source cut: sourceCutFeatureId, sourceSketchId, profileCandidateId,
   and extent with kind blind + positive depthMm or kind through_all.
   Source sketches/extents can intentionally be reused or independently adapted.
4. On Create, supply expectedSourceCuts exactly as inspected, ordered targetCuts,
   fresh newCutFeatureIds and cutEventIds to createMachinedBodyVariant.
   Call exactly once; replace session history with result.history, propagate
   result.invalidation, select result.newBodyId and surface copiedCuts status.
   Do not make a second browser-side commit.

Dependencies use accepted CutRecipeCopyServices (MODEL, SKETCH, profile
discovery, RUNTIME and INTENT cutChain), without a new solver or provider.

## Refusal, dependency and persistence guarantees

The request fences the canonical project, revision and serialized document;
SKETCH admission, source contiguous cut-block order, explicit mm/local_xy frame,
semantic body IDs and new feature/event IDs are validated. INTENT previews
each intended cut against a disposable staged document; a bad second pocket
cannot leave a partially created body. The final document must be canonically
identical to the staged plan, and the operation must consume one undo frame.

SKETCH changes subsequently rebuild only genuinely dependent body features.
Source profiles may remain shared by deliberate user selection, or remain
independent when different sketches were chosen. All features can be edited
using existing dimension, cut-extent, reorder and archive operations.

## Runnable example and qualification commands

    node --experimental-strip-types packages/feature-ops/examples/machined-body-variant.mjs
    node --experimental-strip-types --test packages/feature-ops/test/machined-body-variant.integration.test.mjs
    npm test --workspace @intuit3d/feature-ops
    npm run check:workspace

The real-package example starts with an L-shaped guard, a backing rail and
independent shim. It creates a separate rectangular machined rail with
independent relief and through-vent, then a second new body deliberately
sharing original cut profiles. It checks 21 refused invalid selections,
stable semantic identities, no partial commits, one undo frame for all three
new operations, undo/redo, archive reopening, retrospective guard depth change
and dependency-selective sketch edits. The shim is unchanged.

**Provider boundary:** these are model-backed semantic operations, analytic
SKETCH and preview/pending RUNTIME evaluations; no operation-specific pinned
OCCT8 C++ Boolean, production STEP, independent external-CAD readback or
Windows Firefox graphical validation is claimed. Previously accepted product
#74 evidence is distinct and cannot automatically qualify this new geometry.
