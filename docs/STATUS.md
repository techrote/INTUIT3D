# INTUIT3D — live integration status

**Founding bootstrap.** Repository populated with an initial product/architecture/agent contract. Do not mistake this document for a tested implementation or an automatically updated issue queue.

- Product: intent-first, local-first parametric CAD with Fusion-inspired workbench.
- Orchestration: five fixed scheduled hourly lanes (INTENT, SKETCH, KERNEL, WORKBENCH, INTEGRATION); Scheduswarm dispatcher disabled.
- Implementation: no qualified CAD vertical slice yet at founding bootstrap.
- First target: local workbench + parametric sketch + extrude/cut + historical dimension edit + saved/replayed project + validated STEP.
- Immediate dependencies: workspace/CI bootstrap, model document contract, sketch solver adapter, OCCT worker contract, UI scaffold and cross-lane integration.
- Research reference: radiCADSAC; transfer its architecture/evidence principles, not unqualified manufacturing results as general CAD correctness.
- Release claim: none.

**Maintenance:** INTEGRATION owns edits to this file after accepted, exact-head merges. Cite commit/PR/CI refs; keep status factual and update blockers. Each worker reads live GitHub first rather than trusting stale summaries.
