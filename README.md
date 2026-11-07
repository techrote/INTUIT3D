# INTUIT3D

**Intent-first, local-first parametric CAD for flexible engineering workflows.**

INTUIT3D aims to deliver a serious Fusion-inspired CAD workbench without making a strictly chronological feature tree the sole authority. Users should be able to sketch and model directly, introduce dimensions and dependencies retrospectively, reorder independent operations, preserve temporarily unresolved intent, and recover from topology changes without silent loss of engineering meaning.

**Development mode:** ambitious, predominantly agent-implemented, with eight independent permanent engineering lanes and serialized Integration-owned admission/merges. The repository is the authority, not an individual agent's prior chat.

## North-star demonstration

Create and constrain a plate sketch, extrude a solid, add a hole/cut, change earlier dimensions, reorder independent operations, introduce references retrospectively, save/reopen/replay the design, and export an independently validated STEP file. Keep invalid intermediate operations editable and diagnosable rather than deleting them.

## Core invariants

1. Semantic design intent and immutable edit history are authoritative; OCCT faces, meshes and caches are derived.
2. User creation order is not presumed to equal dependency-required evaluation order. Reorder only when semantics allow it.
3. When a reference, constraint, dependency or feature is ambiguous, report the ambiguity; do not silently guess.
4. Never silently increase tolerances, change intended topology, discard bodies or claim engineering accuracy for preview meshes.
5. Unsolved features retain durable intent, diagnostics and last-known-valid geometry with explicit stale-state labels.
6. Exact kernel operations are isolated and version-pinned; crashes/timeouts must not corrupt the document.
7. Every meaningful research tangent is measured and either integrated, rejected with evidence, or tracked as an owned blocker.

## Development authority

Read in this order:
- [AGENTS.md](AGENTS.md) — mandatory worker and integration rules
- [docs/PRODUCT.md](docs/PRODUCT.md) — product vision and UX
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — source-of-truth, system and interfaces
- [docs/ROADMAP.md](docs/ROADMAP.md) — executable milestone plan
- [docs/OWNER-STEERING.md](docs/OWNER-STEERING.md) — accepted owner guidance, steering intake and programme assessment protocol
- [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md) — five worker lanes and handoffs
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) — evidence and correctness gates
- [docs/RESEARCH-INTAKE.md](docs/RESEARCH-INTAKE.md) — radiCADSAC reuse and tangent handling
- [docs/STATUS.md](docs/STATUS.md) — integration-maintained live programme index
- [SCHEDUSWARM.md](SCHEDUSWARM.md) — scheduswarm dispatcher **disabled**; principles adapted for fixed scheduled workers

## Run the local model-backed CAD workstation

```sh
npm ci
npm run dev:local
```

This single command launches the React CAD workbench at `http://127.0.0.1:5173` **and** a separate loopback-only RUNTIME/native companion. In the workbench, select **MODEL-BACKED CAD** and paste the provider URL and one-session pairing token printed in the local terminal into the **Local native STEP** panel. `Ctrl+C` shuts down both processes. For a bounded startup check without a geometry request, run `npm run dev:local -- --smoke`.

For *experimental* physical STEP execution on supported Linux configurations, install the pinned OCP prototype dependencies first (`python3 -m pip install -r native/requirements-prototype.txt`, or provision the corresponding `PYTHON` environment). The editor's mesh is a labelled preview; browser-native STEP uses experimental OCP 7.9.3.1 and same-engine readback. **This does not establish OCCT 8.0.1 C++ execution or independently validated STEP interoperability.** Saving a model archive preserves authored intent, not a native B-rep file.

## Starting point

The founding bootstrap establishes policy and architecture, **not** a completed CAD kernel or qualified build. Workers should implement functioning, testable vertical slices immediately, prefer in-repository code and demonstrations to planning-only deliverables, and record exactly what ran.

Reference research: [radiCADSAC](https://github.com/techrote/radiCADSAC), [scheduswarm v2](https://github.com/techrote/scheduswarm).

Development is offline-first. Deployment must not require sign-in, cloud geometry services or telemetry.
