# INTUIT3D

**Intent-first, local-first parametric CAD for flexible engineering workflows.**

INTUIT3D aims to deliver a serious Fusion-inspired CAD workbench without making a strictly chronological feature tree the sole authority. Users should be able to sketch and model directly, introduce dimensions and dependencies retrospectively, reorder independent operations, preserve temporarily unresolved intent, and recover from topology changes without silent loss of engineering meaning.

**Evaluation delivery mode (9 Nov 2026):** two active workers concentrate on a well-presented build of accepted features; other engineering lanes are temporarily paused. Source qualification and guarded Integration admission remain in force. [Windows evaluation guide](evaluation/START-HERE.md) · [Evaluation bundle workflow](.github/workflows/evaluation.yml). Until its Windows ZIP/extracted-startup job passes, this is a **release candidate under qualification**, not an already downloadable, Windows-tested release.

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
- [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md) — engineering lane ownership and handoffs
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) — evidence and correctness gates
- [docs/RESEARCH-INTAKE.md](docs/RESEARCH-INTAKE.md) — radiCADSAC reuse and tangent handling
- [docs/STATUS.md](docs/STATUS.md) — integration-maintained live programme index
- [SCHEDUSWARM.md](SCHEDUSWARM.md) — scheduswarm dispatcher **disabled**; principles adapted for fixed scheduled workers

## Run the local model-backed CAD workstation

Requires Node.js 22 or newer. From the repository root:

```sh
npm ci
npm run dev:local -- --smoke  # loopback startup check, no CAD or STEP execution
npm run dev:local             # interactive workbench, experimental OCP companion
```

Open `http://127.0.0.1:5173`, select **MODEL-BACKED CAD**, and paste the terminal's `LOCAL_PROVIDER_URL` and `LOCAL_PAIRING_TOKEN` into the **Local native STEP** panel. Keep the session token private. `Ctrl+C` stops the processes. The smoke test proves only that the web and companion servers start. The default companion is **experimental OCP 7.9**, not the independently qualified pinned C++ provider.

For the **genuine pinned OCCT 8.0.1 C++ path on Linux**, first install and verify the original offline worker bundle using [Platform's installer and pinned-source guide](platform/native-toolchain/README.md). Supply the installed canonical executable path and its independently verified **executable** SHA-256, not the archive SHA:

```sh
export INTUIT3D_OCCT8_WORKER=/absolute/canonical/path/to/installed/worker
export INTUIT3D_OCCT8_WORKER_SHA256=<64-lowercase-hex-worker-digest>
npm run dev:local -- --pinned --smoke
npm run dev:local -- --pinned
```

The pinned launcher **fails closed** on a missing/noncanonical path or wrong worker digest, and has no silent OCP fallback. Its local startup and digest check alone do **not** constitute a native STEP or interoperability acceptance. The accepted [#74 source-matched physical evidence](https://github.com/techrote/INTUIT3D/issues/74) is from specified Linux Chromium sessions, installed C++ worker and independently compiled non-OCCT AnvilCAD verification, for the documented bounded plate/contour geometry only. Windows CI tests the workspace; it is **not** a Windows-native OCCT8 execution.

**Human replay:** Start with **New sketch-first project**, use four actual sketch-plane clicks to create vertices and **Close** the contour; use the accepted Extrude and explicitly targeted Cut controls; edit the earlier extrusion thickness and Undo/Redo; save the model archive, select it through import review, confirm Replace, then request a fresh native STEP. Check that previously generated STEP is invalidated after a revision change, and retain the archive/receipt/STEP hashes. Export is independently trustworthy only when its original bytes are verified with a non-OCCT consumer and the same project/revision. For the separate [Windows Firefox #177](https://github.com/techrote/INTUIT3D/issues/177) import gate, the owner reported successful save/load on 9 November 2026 following the original-file replay instructions; the original archive identity, import-stage trace, post-import Undo/Redo and second reopen have not yet been explicitly recorded. Keep that private-file follow-up distinct from Chromium and native STEP qualification. Saving the model archive preserves design intent; a preview mesh is not an exact B-rep.

## Starting point

The founding bootstrap establishes policy and architecture, **not** a completed CAD kernel or qualified build. Workers should implement functioning, testable vertical slices immediately, prefer in-repository code and demonstrations to planning-only deliverables, and record exactly what ran.

Reference research: [radiCADSAC](https://github.com/techrote/radiCADSAC), [scheduswarm v2](https://github.com/techrote/scheduswarm).

Development is offline-first. Deployment must not require sign-in, cloud geometry services or telemetry.
