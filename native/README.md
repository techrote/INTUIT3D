# INTUIT3D native geometry — initial executable OCCT spike

**Scope:** This is a **real OCCT B-rep geometry experiment via Python OCP bindings**, run in a fresh subprocess per operation. It is **not** yet the required pinned OCCT 8.0.1 isolated C++ production kernel, and is not independently certified STEP interoperability. No approximate mesh fallback is used or labelled exact.

## Reproduce (Linux development)

Tested: Linux x86_64, CPython 3.13.5, `cadquery-ocp==7.9.3.1.1` (OCCT `OCP.__version__ == 7.9.3.1`). An OCCT 8.0.1 pinned C++ worker remains a separate qualification target; version, settings, licensing and platform differences can change numerical results. The OCP wheel version is pinned in `requirements-prototype.txt`, but wheel digest/platform have **not** been locked and this dependency must not be silently promoted to production.

```bash
python3 -m pip install -r native/requirements-prototype.txt
bash native/ci.sh
python3 native/run_plate.py --step-output /tmp/intuit3d-plate.step < native/examples/plate-two-holes.request.json
```

The supervisor prints one JSON result. The experiment builds one exact box, cuts cylinders through both faces, verifies B-rep validity and **exactly one solid**, compares OCCT volume and area against elementary analytic invariants, writes a STEP artifact and internally reimports it to perform the same checks. Missing/invalid results, stale response identities, wrong body count, numerical disagreement, crash and deadline expiration **never** produce `validated_exact`. The child may produce noisy OCCT library stdout; the supervisor captures it and trusts only bounded JSON written to its private response file.

The public request envelope is in `native/protocol.py` and `native/examples/`. It accepts finite millimetre dimensions with non-overlapping, strictly interior circular holes; rejects tangencies, invalid IDs, unknown fields, unsupported units and nonfinite values. `featureId` and `revision` are echoed but **not kernel topology identity**. This specialized plate request is a first vertical slice, not a general parametric-feature protocol.

The host chooses a required `--step-output` file path when `exportStep: true`, never the untrusted request. Destination files are published atomically via exclusive hard-link creation; no overwrite or partial export. Results are emitted only after read-back and analytic checks. The subprocess is *failure-isolated*, not a hardened security sandbox: it inherits the invoking user's privileges and filesystem access. Only feed trusted local projects to this experimental runner.

## Evidentiary limits

- **Executed:** OCP `7.9.3.1` B-rep/Boolean/metrics, STEP writer and same-engine STEP reader on Linux, plus supervisor crash/timeout/forged-response tests.
- **Independent:** analytic volume and area algebra only. The import side is **not an independent STEP consumer**; do not describe it as interoperable qualification.
- **Not yet qualified:** OCCT `8.0.1` native C++ build/pin, different OS/CPU architectures, external STEP importer, arbitrary profile/extrusion topology, semantic face lineage, extended micro-cuts/tangencies and malicious-input sandboxing.
- **Research disposition:** **repair then adopt** the one-request/one-process protocol and validation gates; **defer** production adoption of the Python binding and freeze of final OCCT version until an independently checked pinned C++ worker and STEP cross-consumer test exist.

## Integration handoff

INTEGRATION owns root CI/lockfile; this PR intentionally changes only `native/**`. Use `npm run ci:native` to invoke the native gate (requires OCP installed) after merging with current main. The `native/ci.sh` gate refuses to pass if OCP is unavailable. Future TypeScript consumers should adopt a separately versioned `packages/kernel-contract/**` request/result adapter under KERNEL ownership, with module revisions validated by INTENT, and should treat `validated_exact` only as **scope-local** OCCT test evidence pending independent STEP qualification.

Next bounded changes: implement native C++ OCCT 8.0.1 version pin/toolchain with equivalent contract, run the same oracle and negative test corpus on exact candidate head, then test independent STEP import/read-back and add semantic topology lineage evidence before promoting to production.


## Export artifact structural gate

Before atomic publication, `native/step_preflight.py` inspects the actual experimental OCCT STEP bytes. A bounded 32 MiB ASCII AP214/mm gate rejects truncated, wrong-unit, duplicated-entity, extra/missing-solid, missing-cylinder and substituted artifacts without publishing a file. A real OCP worker's valid response is deliberately followed by STEP substitution in the adversarial tests to prove supervisor rejection. These are structural checks **only**, not a full STEP parser, geometry equivalence proof or independent interoperability test; same-engine B-rep/STEP readback and analytic invariants remain separate gates. Only explicitly qualified OCP 7.9.3.1 and its observed AP214/mm structure are admitted; changing the provider or STEP schema requires requalification.


## STEP shell-graph admission (experimental OCP AP214)

The additional pure-stdlib step_graph_guard.py follows actual STEP entity references from the unique B-rep shape representation into its MANIFOLD_SOLID_BREP, CLOSED_SHELL, shell faces and face-surface definitions. A file fails pre-publication if it has dangling references, extra/orphan faces or cylinders, duplicated cylindrical face references, unbound shell topology, or a length unit not referenced by the actual shape representation context. STEP comments and quoted strings cannot spoof declarations or references. Its lexical scope is intentionally the pinned OCP plate writer's AP214 output, not arbitrary STEP, imported CAD, topological correctness, orientation, geometric continuity or security sandboxing.

Reproduce with: python -m unittest discover -s native/tests -p 'test_*.py' -v (OCP 7.9.3.1). The graph test uses a **real** OCCT two-hole STEP export, plus negative tampering of face-to-cylinder links, orphan faces, dangling entity references and detached millimetre units. This prevents false acceptance that global CYLINDRICAL_SURFACE/LENGTH_UNIT string counts cannot detect. It does **not** upgrade the original Python OCP prototype to the intended OCCT 8.0.1 C++ provider and does not certify independent STEP round-trip interoperability.


## One-shot worker process-tree containment (POSIX-qualified)

The supervisor now runs each prototype OCCT subprocess in a private POSIX
session and kills **the whole inherited process group** on deadline or after
the worker leader exits. This prevents a subprocess spawned by a faulty worker
from continuing to modify files after the original operation times out or
claims completion. The parent drains stderr into a fixed **4096-byte tail**
and discards stdout, so high-volume diagnostic output cannot exhaust its
memory. The returned public crash diagnostic remains limited to 600 characters.
Worker startup failure also yields an explicit \`worker_crash\` response, never
a successful geometry result.

Execute \`python3 -m unittest discover -s native/tests -p 'test_*.py' -v\`.
Adversarial tests spawn a descendant that attempts a delayed write **outside**
the worker's temporary directory; on POSIX the marker must never appear after
timeout or successful leader exit. Separate fixtures write more than 150 KiB
of stderr and verify bounded diagnostics. These tests exercise supervision,
not B-rep semantics or an OCCT 8.0.1 C++ provider.

On Windows, the supervisor creates a process group and attempts
\`taskkill /T /F\` on timeout, then force-kills the parent if needed;
**Windows descendant containment is not qualified**, especially when
the leader exits before child cleanup. Detached POSIX descendants that create
their own session, hostile kernel code and filesystem privileges are also not
contained. This is **failure isolation for trusted input**, not a security
sandbox. A production kernel must use an OS job/cgroup or equivalent
lifetime-bound sandbox and independent platform tests.

## Supervisor-owned exact STEP byte readback (OCP experimental provider)

After the authoring OCP worker exits, the host now verifies the actual STEP
artifact's graph **and** launches a fresh, process-isolated OCP STEP reader via
`native/step_audit_worker.py`. The second reader computes its own B-rep validity,
body count, analytic volume/area and exact cylindrical hole locations/radii.
The supervisor validates these measurements against the original authoritative
`plate-v1` request; only the second reader's measurements appear as
`stepReadback` in the admitted response. A SHA-256 digest from the auditor is
checked against the staged bytes before exclusive, atomic export publication.

The adversarial executable fixture substitutes a **different real OCCT STEP**
with exactly the same hole count/radii, volume, area and admissible AP214/mm
graph, but displaced hole centres, after the first worker has already
reported valid original geometry. Structural STEP inspection alone cannot
detect this; supervisor-owned STEP readback rejects it, and never publishes
the substituted artifact. An altered-radius substitution and malformed STEP
also have negative tests. Execute `bash native/ci.sh` for exact local
experimental OCP qualification.

**Scope limits:** This confirms integrity of the *bytes actually published*
relative to intended plate geometry, rather than trusting the producer's
readback claim. Both readers use **OCP 7.9.3.1 / OCCT 7.9.3.1** and share the
same geometry algorithms; this is **not independent STEP interoperability**
or a replacement for the OCCT 8.0.1 C++ production worker, native Windows
qualification or a hostile-worker sandbox. The SHA-256 gate checks byte
consistency, not authenticity of an external CAD parser or semantic lineage.
