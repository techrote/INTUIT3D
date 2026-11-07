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
test -s "$output/model.initial.step"
test -s "$output/model.edited.step"
test -s "$output/model.intuit3d.json"
echo 'MODEL_NATIVE_EXPERIMENTAL_EXECUTED: real INTENT/SKETCH/RUNTIME to OCP 7.9.3.1 with two STEP files and serialized archive'
echo 'NOT_QUALIFIED: OCCT 8.0.1 C++, external STEP consumer, Windows native OCP, browser exactness, human acceptance'
