# Pinned OCCT 8.0.1 source acquisition

The existing [offline C++ qualification runner](README.md) requires a clean local
Open-Cascade-SAS OCCT checkout at `b8f597c677811d1f9f4d8a97f5ae2825c0353a42`.
On a network-enabled Linux host, acquire exactly that source:

```bash
python3 platform/native-toolchain/fetch_pinned_occt.py \
  --destination /tmp/intuit3d-occt801-source \
  --evidence /tmp/intuit3d-occt801-source-evidence
cat /tmp/intuit3d-occt801-source-evidence/acquisition.json
git -C /tmp/intuit3d-occt801-source rev-parse HEAD

# Then supply a separate checkout containing the still-Draft KERNEL PR #67.
python3 platform/native-toolchain/qualify.py \
  --kernel-tree /path/to/INTUIT3D-with-PR67 \
  --source /tmp/intuit3d-occt801-source \
  --prefix /tmp/intuit3d-occt801-prefix \
  --output /tmp/intuit3d-occt801-native-qualification --jobs 2
```

The fetcher requests the immutable Git commit, never a moving branch or tag.
It uses filtered shallow transfer when supported, verifies the exact HEAD, clean
checkout, commit object and CMake entry point, then publishes the source into
a previously nonexistent directory. Fetch failures preserve numbered Git logs
and an explicit `BLOCKED` evidence manifest, without leaving a partial source.
Source and evidence destinations must not already exist.

**`PINNED_SOURCE_FETCHED_ONLY` is not native compilation or geometry acceptance.**
`qualify.py` remains the only native execution gate; a successful C++ run
still does not establish independent STEP interoperability. Separate non-OCCT
CAD acceptance is required under `conformance/external-cad/**`.

Run real local Git transport regressions (not a mocked Git subprocess):

```bash
python3 -m unittest discover -s platform/native-toolchain -p 'test_fetch_pinned_occt.py' -v
```

The developer environment used for this change cannot resolve GitHub DNS.
The official-remote fetch was attempted and correctly returned `BLOCKED`,
exit 2, preserving its failure logs and no published source tree. Integration
owns shared CI registration, while KERNEL retains the native C++ source.
