# Body-operation lifecycle v1

Consumable selected-body **Remove / Restore** commands over accepted INTENT
feature-lifecycle tombstones and RUNTIME evaluation. This is an additive
versioned FEATUREOPS subpath, not a new journal, provider or view-state hide.

Import \`@intuit3d/feature-ops/body-operation-lifecycle/v1\`. Inject actual
\`model\`, \`runtime\` and \`lifecycle\` package namespaces. Present the result of
\`inspectSelectedBodyRemoval(history, selection, services)\` in the UI,
including transitive dependents and the exact target body. Then call
\`removeSelectedBodyOperation(history, {...selection, expectedDependents,
mode, confirmCascade, eventIds}, services)\`.

- \`reject_if_referenced\` rejects deletion of a referenced writer.
- \`keep_dependents_pending\` removes only the selected cut/extrude, leaving
  downstream authoring recoverably unresolved. It does not hide a stale solid.
- \`cascade_descendants\` explicitly retires the selected feature and its
  same-body dependent cuts in one undo frame, with confirmed impact.
  Cross-body or non-body cascade requires an intentional INTENT-level workflow.
- \`restoreSelectedBodyOperations\` restores exact named tombstones using
  \`require_ready\` or \`permit_unresolved\` semantics; it never allocates a
  replacement feature ID or guesses the body.

The consumer must pass \`expectedProjectId\`, \`expectedRevision\`, \`units:'mm'\`,
\`frame:'local_xy'\`, explicit \`targetBodyId\` and author-assigned unique event
IDs. A stale dependency impact, wrong body, removed selection, unsupported
schema or unconfirmed cascade rejects without changing the input history.

Run \`node --experimental-strip-types
packages/feature-ops/examples/actuator-rail-lifecycle.mjs\` or
\`npm test --workspace @intuit3d/feature-ops\`. The example exercises a stepped
pneumatic actuator rail with a longitudinal channel, 4 mm port and separate
gauge window, plus an independent cover: remove nonterminal channel, retain
blocked downstream intent, undo/redo, archive reopen, restore original ID,
edit rail depth 10→14 mm, and independently cascade/restore the full cut chain.

**Evidence boundary:** RUNTIME reports preview/pending/unresolved semantics.
No native Boolean, pinned OCCT C++ geometry or STEP output is executed by
this feature operation. Prior exact geometry must be invalidated after any
tombstone change. KERNEL/PLATFORM/INTEGRATION own physical qualification.
