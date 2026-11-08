# Pinned OCCT 8.0.1 C++ — execution-first native qualification

**Owner:** Native Build, exclusively `platform/native-toolchain/**`. **Source baseline:** see PR commit. **Kernel dependency:** [KERNEL draft #67](https://github.com/techrote/INTUIT3D/pull/67). **Acceptance:** [#3](https://github.com/techrote/INTUIT3D/issues/3), [#74](https://github.com/techrote/INTUIT3D/issues/74), [#81](https://github.com/techrote/INTUIT3D/issues/81).

This subtree deliberately extracts the previously developed exact-pin source acquisition and real C++ build/STEP qualification tools from the paused, mixed-ownership Draft #89. Unlike that mixed branch it does **not** contain or modify independent CAD conformance, the kernel worker, shared root CI, or the program steering files.

## Execute on an actual network-enabled GitHub-hosted Ubuntu runner

`occt8-github-actions.template.yml` is an **opt-in native execution workflow** stored under Platform ownership until INTEGRATION installs it as `.github/workflows/occt8-native.yml`. On manual dispatch, it checks out **both unmerged Draft PRs** rather than `main`: Platform #122 via `refs/pull/122/head` and KERNEL #67 via `refs/pull/67/head` (or operator-supplied immutable 40-character SHAs). It records each checked-out SHA in `versions.txt`. The workflow is deliberately **not** triggered by every push or PR update: the expensive first C++ build must finish without repeated supersession. INTEGRATION should install the workflow into its own `.github/**` source branch, merge that guarded workflow change into `main`, then dispatch it with the current candidate refs; later reproduce against the recorded exact SHAs. Example after installation: `gh workflow run occt8-native.yml --ref main -f platform_ref=refs/pull/122/head -f kernel_ref=refs/pull/67/head`. Do **not** claim a prepared workflow constitutes an executed hosted run. Existing workspace CI does not compile OCCT8 C++.

The workflow provisions the real pinned OCCT **8.0.1** commit `b8f597c677811d1f9f4d8a97f5ae2825c0353a42`, installs the exact RCS-006 headless shared C++17 toolkits, compiles the actual #67 C++ worker, exports **8 mm and 12 mm STEP**, runs same-engine and bounded Part 21 checks, then executes the KERNEL-native bridge tests with the real worker path. It retains command logs, version/commit identities, worker SHA-256 and STEP artifact digests. Source/install and huge intermediate build directories are excluded from GitHub Actions evidence upload.

### Manual commands on a capable Linux host

With a clean **separate** checkout of the current KERNEL #67 at `/path/to/kernel-tree`:

```bash
mkdir -p /tmp/occt801-build-work /tmp/occt801-evidence
python3 platform/native-toolchain/fetch_pinned_occt.py \
  --destination /tmp/occt801-build-work/source \
  --evidence /tmp/occt801-evidence/source-fetch
python3 platform/native-toolchain/qualify.py \
  --kernel-tree /path/to/kernel-tree \
  --source /tmp/occt801-build-work/source \
  --prefix /tmp/occt801-build-work/prefix \
  --output /tmp/occt801-evidence/qualification \
  --jobs 2 --timeout 5400 --native-timeout 60
```

The fetch is a real exact SHA Git operation, not floating `main` or downloaded synthetic fixtures. The build invokes real CMake/C++ and generates actual STEP. `qualification.json.status=NATIVE_EXPERIMENTAL_PASS` is required for passing both native operations. Independently run:

```bash
INTUIT3D_OCCT8_WORKER=/tmp/occt801-evidence/qualification/worker-build/intuit3d_occt8_plate \
  python3 -m unittest discover -s /path/to/kernel-tree/native/tests -p test_occt8_bridge.py -v
```

Contract tests (which **are not** physical qualification):

```bash
python3 -m unittest discover -s platform/native-toolchain -p 'test_*.py' -v
```



## Source-matched, relocatable **offline Linux worker** bundle

Once an **actual** pinned C++ qualification has produced `NATIVE_EXPERIMENTAL_PASS`
for both 8 mm and 12 mm plates, create an offline worker + all fourteen
SONAME-linked shared OCCT toolkits, bridge, source-matched requests and genuine
STEP evidence. This is different from uploading only the executable: the real
C++ worker's build-time absolute GNU `DT_RPATH` otherwise names the temporary
runner installation, and its transitive `libTK*.so` dependencies are not
available after extraction.

**Hosted prerequisites:** `patchelf`, `binutils`, Python 3, CMake/Ninja,
C++17 compiler; GitHub runner must have already executed `qualify.py` with the
new `kernelSourceCommit` evidence field and kept the pinned OCCT prefix.

```bash
python3 platform/native-toolchain/bundle_offline.py \
  --qualification /path/to/executed/qualification \
  --prefix /path/to/verified/occt-prefix \
  --kernel-tree /path/to/exact/kernel-checkout \
  --output /tmp/occt801-offline
# Emits /tmp/occt801-offline.tar.gz only after relocated real 8 + 12 mm
# compiled-C++ geometry and Part 21 checks PASS.
```

Extract the tarball into a **different** location, not the original build tree;
from the extracted folder:

```bash
python3 verify.py
python3 selftest.py  # fresh 8mm and 12mm actual C++/STEP replay with numeric checks
./run.sh --part21-step-audit --step-output /tmp/verified.step \
  < requests/plate-8mm.json
```

The bundled launcher invokes the unchanged KERNEL subprocess bridge with the
genuine relocated C++ worker. Its origin-relative `DT_RPATH` resolves the
correct OCCT toolkits transitively, with no host OCCT fallback. The manifest
contains the original worker SHA, patched/relocated worker SHA, original
8/12 mm STEP SHA, immutable OCCT source pin and exact KERNEL checkout SHA,
per-file SHA-256, SONAME symlink map, C++ runtime resolution and fresh
post-relocation analytic/STEP results. The packager now extracts its exact
tar.gz bytes into a second temporary location, verifies the entire inventory,
and requires the included `selftest.py` to execute fresh 8/12 mm C++ solids
and Part 21-audited STEP with analytic volume and hole-position checks before
the archive can report success. The replay requires no source checkout or
build toolchain; run it after moving the extracted bundle to the target Linux
machine. An extracted replay failure removes the incomplete output/archive.
This proves execution after relocation on the tested Linux host, **not**
cross-distro ABI, Windows or independent external-CAD compatibility.

**Portability boundary:** Linux ELF plus compatible glibc/libstdc++ and Python
3; this does **not** prove Windows-native execution, general geometry support
or full non-OCCT external CAD STEP interoperability. The same-engine and strict
Part 21 subset oracles do not replace external CAD qualification. INTEGRATION
owns the workflow installation and immutable archive retention.

### Evidence boundaries and next action

- Network-disabled shells without the pinned OCCT source or attested prefix are **BLOCKED**; their synthetic test PASS is **not** a native success. GitHub-hosted runner capability must be tested separately.
- Actual pinned OCCT8 C++ plate/STEP PASS is still **experimental** pending independent non-OCCT CAD reconstruction in the separate STEP lane. Python OCP 7.9.3.1 is never a substitute for C++ execution.
- If the real build exposes a genuine `native/**` defect, provide the exact compiler output to KERNEL #67. Do not change another lane's source here.
- INTEGRATION alone copies the workflow into `.github/**`, runs the actual hosted job, decides qualified admission, preserves original evidence beyond Actions retention, and updates shared steering docs.


## Install a verified offline bundle for the real RUNTIME bridge

A published \`offline-occt801.tar.gz\` is not itself a deployed worker.
Use \`install_offline.py\` to install into a **new** destination after verifying
the exact archive SHA-256 and the immutable source-matched KERNEL commit.
This requires Linux/Python 3.12+ (for safe tar extraction) and **no network,
OCCT source checkout or build-time prefix**.

\`\`\`bash
python3 platform/native-toolchain/install_offline.py \
  --archive /path/to/offline-occt801.tar.gz \
  --expected-sha256 <64-hex-digest-from-native-job> \
  --kernel-sha <40-hex-commit-actually-built> \
  --destination "$HOME/.local/share/intuit3d/occt801-<source-shortsha>"
\`\`\`

The command fails closed without publishing the destination on archive-hash,
source, full inventory/SONAME or **four actual extracted C++/STEP replay**
failures. It rejects unsafe tar paths, non-library symlinks, existing targets
and non-Linux hosts. A successful JSON result includes \`workerPath\`,
\`runScriptPath\`, both exact source pins and the verified replay cases.
The caller may then set \`INTUIT3D_OCCT8_WORKER\` to the returned
\`workerPath\` for the real \`@intuit3d/workflow-runtime\` local pinned
bridge; preserve the ordinary browser/worker security boundary.

This does **not** prove Windows compatibility, cross-distribution
glibc/libstdc++ portability, or independent CAD interoperability.
Only a real pinned-hosted generated archive followed by the actual extracted
C++ selftest is an \`OFFLINE_OCCT8_INSTALL_PASS\`; test fixtures which compile
a small ELF are explicitly *installer logic tests, not native geometry*.

Focused local installer tests (Linux with a C compiler):

\`\`\`bash
python3 -m unittest discover -s platform/native-toolchain -p test_install_offline.py -v
\`\`\`


### ABI compatibility record and preflight

The Platform bundle now records \`elfAbiProfile\` in \`manifest.json\` for the
real copied C++ executable **and every physical bundled OCCT toolkit**. It
captures exact ELF machine, per-object \`DT_NEEDED\` inventory, and symbol
version *requirements* (the maximum actually required \`GLIBC\`,
\`GLIBCXX\` and \`CXXABI\`, without confusing provider definitions with
requirements). After the existing SHA/SONAME manifest verification and
**before executing C++**, \`install_offline.py\` recomputes the record
against the extracted ELF, requires an exact match, checks all resolved
\`libTK*.so\` paths stay in the bundle, and runs the host loader's
\`ldd -v\` version compatibility check. The resulting
\`HOST_ELF_ABI_PREFLIGHT_PASS\` is attached to the successful installation
receipt, giving users an actionable ABI diagnosis rather than an opaque
runtime loader failure.

Installation therefore requires **Linux with \`readelf\` (binutils), \`ldd\`,
and Python 3.12+**, with the platform repository's \`abi_compat.py\`
present alongside \`install_offline.py\`. These checks do not bundle the
host's glibc or libstdc++ and do not claim cross-distro binary
compatibility. Only actual installed C++ and STEP replay can qualify a
consumer host. A new test suite compiles a real versioned transitive ELF
library and exercises positive/negative ABI records:

\`\`\`bash
python3 -m unittest discover -s platform/native-toolchain \
  -p 'test_abi_compat.py' -v
python3 -m unittest discover -s platform/native-toolchain \
  -p 'test_install_offline.py' -v
\`\`\`


## Source-matched Linux archive to real RUNTIME product qualification

PLATFORM can now exercise the **real RUNTIME local-bridge demo** on the
installed genuine OCCT 8.0.1 bundle, not merely the standalone 8/12 mm C++
worker. The platform/native-toolchain/qualify_runtime_delivery.py gate is
Linux-only and network-free. Provision a trusted native archive SHA-256 and
clean immutable 40-digit Platform and Runtime source checkouts. Install Node
22.6+ and run npm ci in the separate Runtime checkout before executing it.

The gate installs the archive into a temporary directory, enforces the
existing pinned KERNEL source, ELF ABI and actual four-case C++/STEP replay,
then runs the already accepted RUNTIME Node local-bridge demo with
INTUIT3D_OCCT8_WORKER pointing to that **installed, SHA-verified** worker.
It checks seven physical STEP receipts: initial 8 mm, retrospective 12 mm,
bore locations/radii resize, undo bore edit, undo thickness, edited archive
reopen, and original archive reopen. STEP SHA, measured material volume and
hole geometry must change and restore as specified. Only after all seven
cases pass does the gate publish the destination; failures clean staging.

Example on the GitHub-hosted builder using three separate exact-SHA checkouts:

~~~bash
set -euo pipefail
python3 platform-repo/platform/native-toolchain/qualify_runtime_delivery.py \
  --archive "$RUNNER_TEMP/intuit3d-native-work/offline-occt801.tar.gz" \
  --archive-sha256 "$(sha256sum "$RUNNER_TEMP/intuit3d-native-work/offline-occt801.tar.gz" | cut -d' ' -f1)" \
  --kernel-sha "$(git -C kernel-repo rev-parse HEAD)" \
  --platform-sha "$(git -C platform-repo rev-parse HEAD)" \
  --runtime-tree "$GITHUB_WORKSPACE/runtime-repo" \
  --runtime-sha "$(git -C runtime-repo rev-parse HEAD)" \
  --destination "$RUNNER_TEMP/intuit3d-native-work/occt801-runtime-installed" \
  | tee "$RUNNER_TEMP/intuit3d-native-evidence/runtime-delivery.json"
~~~

The SHA calculated on the *same trusted native builder* is usable for this
in-job gate. For downloaded archives use the SHA from a separately trusted
build receipt instead, not the untrusted download itself. Run local contract
tests with:

~~~bash
python3 -m unittest discover -s platform/native-toolchain \
  -p test_qualify_runtime_delivery.py -v
~~~

These tests genuinely execute Node.js and a compiled toy ELF but provide
**synthetic native/STEP receipts** to exercise admission and atomicity.
They are not physical OCCT qualification. Hosted execution using the
real installed OCCT worker remains the required product gate. Independent
AnvilCAD import, browser graphical acceptance, Windows-native compilation
and cross-distribution ABI are separate.


## Preserve the physical STEP outputs of the extracted offline worker

The real C++ archive self-test now supports an **optional durable output directory**.
Its original four cases remain mandatory and fail closed; this option preserves
the newly generated STEP bytes instead of deleting them with the replay's
temporary directory. The output is **outside the distributed bundle** so the
signed inventory is not changed.

```bash
python3 platform/native-toolchain/bundle_offline.py \
  --qualification /path/to/qualification \
  --prefix /path/to/pinned-occt-prefix \
  --kernel-tree /path/to/exact-kernel-checkout \
  --output /tmp/occt801-offline \
  --replay-evidence /tmp/actual-extracted-four-step-evidence
```

The fresh evidence directory contains
`fresh-{8,12,edited8,restored8}.step`, matching
`request-{8,12,edited8,restored8}.json` and `evidence.json`
with individual STEP/request SHA-256 digests and exact KERNEL/OCCT/worker
source identities. It is published only after four genuine C++ executions,
STEP/readback/volume checks, a dimensional edit and restoration all succeed.
Any failure removes the temporary evidence output without suppressing the
C++ failure. The source-matched hosted example in the Platform-owned workflow
template retains these bytes under its uploaded native-evidence directory.

Existing installed archives may also be re-executed with
`python3 selftest.py --evidence-dir /new/output/directory`; the destination
must not exist. These files are **same-engine C++/Part 21 evidence**, *not*
proof of independent non-OCCT import. Integration may pass the immutable
STEP files and hashes to the STEP conformance lane for additional independent
checks without rerunning the costly OCCT compilation.


## Re-attest an offline Linux installation before reopening a local RUNTIME session

The archive installer returns `manifestSha256` in addition to `archiveSha256`,
`workerSha256` and `kernelSourceCommit`. Save its JSON output **outside**
the installed bundle; the installed directory is not its own trust anchor.
The independent manifest digest is required on each new local session so
changed bridge code, SONAME symlinks, verification scripts and the C++ ELF
cannot authenticate themselves merely by rewriting a local manifest.

Using an already downloaded, SHA-256-verified archive (no network, compiler,
CMake or OCCT prefix required):

```bash
python3 platform/native-toolchain/install_offline.py \
  --archive /path/to/offline-occt801.tar.gz \
  --destination "$HOME/intuit3d/native/current" \
  --expected-sha256 <independently-recorded-archive-sha256> \
  --kernel-sha <immutable-kernel-commit> \
  > "$HOME/intuit3d/native-install-receipt.json"

# Use the pinned fields from that saved external receipt, not a newly
# computed digest or source identity obtained from the installed directory.
python3 platform/native-toolchain/resume_offline.py \
  --directory "$HOME/intuit3d/native/current" \
  --manifest-sha256 <receipt-manifestSha256> \
  --kernel-sha <receipt-kernelSourceCommit> \
  --worker-sha256 <receipt-workerSha256> \
  --replay
```

Reopening verifies the independently pinned manifest, full installed file and
SONAME inventory **before executing bundled verification code**, the actual
host loader/ELF ABI, and (with `--replay`) four freshly executed C++/STEP
edit/restoration cases. Without `--replay`, the operation is a less expensive
file/source/ABI preflight, **not proof of freshly run native geometry**.
`--worker-path-only` prints the checked executable path for export as
`INTUIT3D_OCCT8_WORKER`; this command does **not** launch or qualify the
separate RUNTIME session. Installation paths may have any directory name.
Windows-native/MSVC and independent CAD interoperability remain unqualified
by this Linux-only operational path.

```bash
python3 -m unittest discover -s platform/native-toolchain -p 'test_*.py' -v
```

The restart regression compiles a genuine small C/ELF fixture to exercise
SONAME resolution, standalone re-attestation and fail-closed tamper cases;
it is **not** itself OCCT8 qualification. Physical archived OCCT8 geometry
must be tested separately against the source-matched hosted bundle.
