# Associative circular-hole pattern v1

Use \`@intuit3d/sketch/arc-hole-pattern/v1\` to turn a solved line/arc plate and a selected circular hole into a **persistent, editable rectangular bolt pattern**. It composes the existing SKETCH nonlinear solver and globally checked analytic profile; it does not create a second document history, replace RUNTIME, or claim physical B-rep or STEP exactness.

- \`proposeArcHolePattern(sketch, selection, null, {kind:'create',...}, stamp)\` creates fixed, semantically named pattern members in one solver-checked edit.
- \`kind:'reconfigure'\` changes row/column counts and signed spacing in one edit; surviving entity IDs remain stable and absent members are removed only when they have no extra authored dependencies.
- \`kind:'edit-seed'\` changes the seed position **and** diameter and propagates both to members atomically. \`kind:'refresh'\` propagates a separately edited seed after its source revision changed.
- \`adoptArcHolePattern\` upgrades a matching array already created by \`arc-profile-tools/v1\` without rewriting its geometry. Member edits that diverge from the last generated positions/radii are **refused**, not erased.
- Every proposal requires signatures for source sketch, profile selection, and pattern parameters. The persisted \`ArcHolePattern\` carries only stable IDs, dimensions and the last-generated seed snapshot. Save/reopen it **alongside** the sketch and selection as part of a single INTENT/RUNTIME journal entry. Refused changes leave the inputs untouched.

\`inspectArcHolePattern\` returns \`synchronized\`, \`seed_changed\` or \`unresolved\` to support an inspector/recovery UI. Successful proposals include \`sketch\`, \`selection\`, \`pattern\`, solved analytic \`profile\`, and created/removed/preserved semantic entity IDs, ready for one authoritative commit by the consumer.

Run from the repository root:

\`\`\`bash
node packages/sketch/examples/associative-hole-pattern.mjs
node --test packages/sketch/test/arc-hole-pattern.test.mjs
npm run typecheck --workspace @intuit3d/sketch
\`\`\`

**Scope:** Solved 2D millimetre sketch and analytic line/arc/circle containment checks. The profile is \`providerSubmissionReady\` only for **separate** native validation. \`nativeExact:false\`, \`exactBrepAvailable:false\`, and \`stepQualified:false\` remain explicitly false. No Chromium interaction, OCCT 8.0.1 B-rep or independent STEP result is claimed by these sketch operations.
