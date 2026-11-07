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
This requires Linux/Python 3.13+ (for safe tar extraction) and **no network,
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
