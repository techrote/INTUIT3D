#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# The native smoke gate must execute REAL OCCT, not accept missing bindings.
# On a clean hosted runner, install the explicitly pinned research wheel into
# an isolated throwaway venv. Never substitute a newer backend silently.
python_cmd="${PYTHON:-python3}"
venv=""
cleanup() { if [[ -n "$venv" ]]; then rm -rf -- "$venv"; fi; }
trap cleanup EXIT
if ! "$python_cmd" -c 'import OCP; assert OCP.__version__ == "7.9.3.1"' >/dev/null 2>&1; then
  venv="$(mktemp -d "${TMPDIR:-/tmp}/intuit3d-ocp-ci-XXXXXXXX")"
  "$python_cmd" -m venv "$venv"
  python_cmd="$venv/bin/python"
  "$python_cmd" -m pip install --disable-pip-version-check -r native/requirements-prototype.txt
fi
"$python_cmd" - <<'PY'
import OCP
assert OCP.__version__ == '7.9.3.1', f'unqualified OCCT version: {OCP.__version__}'
print('EXPERIMENTAL_OCCT_OCP_VERSION:', OCP.__version__)
PY
"$python_cmd" -m unittest discover -s native/tests -p 'test_*.py' -v
printf '\nNATIVE_EXPERIMENTAL_EXECUTED: OCP plate B-rep and STEP internal read-back only.\n'
printf 'NOT QUALIFIED: pinned OCCT 8.0.1 C++ worker, external STEP consumer, cross-platform deployment.\n'
