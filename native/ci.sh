#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import OCP
print('EXPERIMENTAL_OCCT_OCP_VERSION:',OCP.__version__)
PY
python3 -m unittest discover -s native/tests -p 'test_*.py' -v
printf '\nNATIVE_EXPERIMENTAL_EXECUTED: OCP plate B-rep and STEP internal read-back only.\n'
printf 'NOT QUALIFIED: pinned OCCT 8.0.1 C++ worker, external STEP consumer, cross-platform deployment.\n'
