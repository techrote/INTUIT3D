#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Hosted Linux integration: one pinned experimental OCP environment for both
# the established native regression gate and the actual model-to-STEP workflow.
# Never claim this is production OCCT 8.0.1 or independent STEP interoperability.
venv="$(mktemp -d "${TMPDIR:-/tmp}/intuit3d-ocp-integration-XXXXXXXX")"
trap 'rm -rf -- "$venv"' EXIT
python3 -m venv "$venv"
"$venv/bin/python" -m pip install --disable-pip-version-check -r native/requirements-prototype.txt
export PYTHON="$venv/bin/python"
npm run ci:native

output="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/intuit3d-model-native-evidence"
mkdir -p "$output"
node tooling/model-native-plate.mjs "$output/model" 12
# New accepted RUNTIME #61: independently execute its actual trusted-provider
# coordinator against this same pinned OCP environment. This is the admission
# test that #61's exact-head source-only hosted CI did NOT perform.
npm run demo:native --workspace @intuit3d/workflow-runtime
# Real RUNTIME trusted HTTP bridge -> actual pinned OCP, not a synthetic provider.
npm run demo:bridge --workspace @intuit3d/workflow-runtime
# DIFFERENT real mechanical part: FEATUREOPS 4→5-hole flange, retrospective
# 10→16 mm edit, undo/reopen and four physical same-engine OCP STEP artifacts.
node tooling/featureops-native-flange.mjs "$output/flange"
for variant in four thick five undo; do test -s "$output/flange.$variant.step"; done
test -s "$output/flange.intuit3d.json"
# Real Chromium UI -> RUNTIME local host -> experimental OCP -> browser STEP download.
# The WORKBENCH generated-lock browser CI separately covers stale-response
# cancellation with a deterministic synthetic server; this is real geometry.
npm run build --workspace @intuit3d/web
INTUIT3D_REAL_NATIVE_BROWSER_ARTIFACTS="$output/real-native-browser" node tooling/real-native-browser-smoke.mjs
test -s "$output/model.initial.step"
test -s "$output/model.edited.step"
test -s "$output/model.intuit3d.json"
echo 'MODEL_NATIVE_EXPERIMENTAL_EXECUTED: real INTENT/SKETCH/RUNTIME to OCP 7.9.3.1 with two-hole and four/five-hole STEP files, undo and archives'
echo 'NOT_QUALIFIED: production OCCT 8.0.1 C++, independent external STEP consumer, Windows native OCP, human acceptance'
