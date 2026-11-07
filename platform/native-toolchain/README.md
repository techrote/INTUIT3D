# INTUIT3D PLATFORM-001 — pinned native C++ build and qualification

**Status: executable offline build/qualification harness, not production exactness evidence.** Owner mandate [#81](https://github.com/techrote/INTUIT3D/issues/81); kernel dependency [Draft #67](https://github.com/techrote/INTUIT3D/pull/67). Exclusively owned by PLATFORM; KERNEL retains `native/**`, INTEGRATION owns CI and merges.

This harness brings the already designed **RCS-006 exact OCCT 8.0.1 headless profile** into a one-shot, fail-closed provisioning + *real binary* qualification. It does not vendor OCCT, fetch source silently, trust a system OCCT, or substitute Python OCP for C++. It accepts two legitimate starting points:

1. A **locally available, clean Git checkout** of Open-Cascade-SAS/OCCT at `b8f597c677811d1f9f4d8a97f5ae2825c0353a42`; `--source` builds 14 required shared toolkits using the same RCS-006 flags and installs an attested prefix.
2. An **already installed, attested RCS-006 prefix**; omit `--source`. The tool verifies source version/profile attestation, header, shared-toolkit ELF identity, paths and SHA-256 (this *preflight alone* is not proof of native execution).

Both require a separate **INTUIT3D kernel checkout containing PR #67**, until Integration admits it to `main`. Run on Linux with CMake >=3.20, Ninja, C++17 compiler and Python 3.9+; supply a writable fresh evidence directory. Example from the INTUIT3D checkout:

```bash
# Option A — build OCCT from a previously fetched, pinned clean Git checkout:
python3 platform/native-toolchain/qualify.py \
  --kernel-tree /path/to/INTUIT3D-with-kernel-PR67 \
  --source /path/to/occt-at-b8f597c... \
  --prefix /tmp/intuit3d-occt8-install \
  --output /tmp/intuit3d-platform-qualification-01 --jobs 2

# Option B — use an already pinned RCS-006 installation:
python3 platform/native-toolchain/qualify.py \
  --kernel-tree /path/to/INTUIT3D-with-kernel-PR67 \
  --prefix /path/to/verified-rcs006-occt-8.0.1 \
  --output /tmp/intuit3d-platform-qualification-02 --jobs 2
```

For source provisioning, **fetch the OCCT Git commit ahead of time**. This harness deliberately does not download code, because some CI/cloud environments have no GitHub DNS. It refuses wrong checkout SHA and dirty source; an existing prefix is never overwritten. The canonical [radiCADSAC RCS-006 bootstrap](https://github.com/techrote/radiCADSAC/blob/main/research/rcs-006/harness/bootstrap_occt.sh) is an alternative on a networked Linux host.

After verifying/installing the prefix, the harness compiles `native/occt8/plate_worker.cpp` from the supplied KERNEL checkout with that OCCT prefix, invokes **that exact compiled executable** via `native/occt8_bridge.py` for two actual 8 mm and 12 mm hole-plate cases, requires the bounded independent-implementation *Part 21 plate-subset* readback gate, checks complete semantic identity and revision, analytically computes expected volume/area/hole positions and hashes actual immutable STEP files. It writes `qualification.json`, numbered command logs, exact requests/responses, two STEP outputs, worker SHA-256 and every linked library's file hash. `--native-timeout 30` bounds each worker attempt. A failure exits nonzero and records a `BLOCKED` manifest; no success report is fabricated.

**Evidence hierarchy:** `NATIVE_EXPERIMENTAL_PASS` means the genuine pinned C++ process and the plate-specific STEP checks executed, not production admission, general exact CAD, independent non-OCCT CAD import, Windows-native, or end-user certification. The KERNEL Part 21 reader is a separately implemented, bounded parser of the plate subset, *not* a full independent CAD B-rep engine. Keep `independentCadInteroperability: false` until [Integration #74](https://github.com/techrote/INTUIT3D/issues/74) obtains a genuine external non-OCCT reader and geometric oracle. Preserve the resulting artifacts and qualification.json for Integration's separate exact-head admission.

Tests that run without OCCT (synthetic cases deliberately **never** count as native geometry execution):

```bash
python3 -m unittest discover -s platform/native-toolchain -p 'test_qualify.py' -v
```

**Current blocker**: the present agent environment has neither an OCCT 8.0.1 installation nor access to GitHub DNS, so the C++ worker cannot be compiled here. The code was locally unit-tested; genuine native runs require a pinned source or prefix on a capable host. This is an explicit `BLOCKED` outcome, not an engineering qualification.
