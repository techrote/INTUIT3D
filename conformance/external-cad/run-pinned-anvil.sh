#!/usr/bin/env bash
# Source-pinned independent Rust AnvilCAD STEP B-rep/mesh reconstruction, no OCCT.
# Invoked only if real BRL-CAD 7.44.0 importer provably cannot construct
# the original non-OCCT physical flange geometry.
set -Eeuo pipefail
bundle='' evidence=''
while (($#)); do
  case "$1" in
    --bundle) bundle=${2:?}; shift 2;;
    --evidence-dir) evidence=${2:?}; shift 2;;
    *) echo "Unexpected AnvilCAD runner argument: $1" >&2; exit 2;;
  esac
done
if [[ -z "$bundle" || -z "$evidence" || -e "$evidence" ]]; then
  echo 'REJECT: need --bundle FILE --evidence-dir FRESH_PATH' >&2; exit 3
fi
for binary in git cargo rustc sha256sum python3; do
  command -v "$binary" >/dev/null || { echo "REJECT: missing $binary" >&2; exit 3; }
done
# Fixed upstream source identity, not a moving branch or mismatched OCCT reader.
pin='50c053840933c92d598976e837e63ccd7626c312'
mkdir -p "$evidence"
git clone --quiet --filter=blob:none https://github.com/swperb/anvilcad.git "$evidence/anvilcad"
git -C "$evidence/anvilcad" -c advice.detachedHead=false checkout --quiet --detach "$pin"
actual=$(git -C "$evidence/anvilcad" rev-parse HEAD)
[[ "$actual" == "$pin" ]] || { echo 'REJECT: alternate STEP source pin mismatched' >&2; exit 3; }
{
  echo 'Independent engine: swperb/anvilcad anvil-step / Rust BRep'
  echo "Pinned upstream source Git commit: $actual"
  git -C "$evidence/anvilcad" status --porcelain=v1
  sha256sum "$evidence/anvilcad/Cargo.lock"
  cargo -V
  rustc -Vv
} > "$evidence/provenance.log"
cp -- conformance/external-cad/anvil_step_probe.rs \
  "$evidence/anvilcad/crates/anvil-step/examples/intuit_step_probe.rs"
(
  cd "$evidence/anvilcad"
  cargo build --locked --release -p anvil-step --example intuit_step_probe
) > "$evidence/cargo-build.log" 2>&1 || {
  echo "BLOCKED: independent Rust import probe did not compile; inspect $evidence/cargo-build.log" >&2
  exit 3
}
probe="$evidence/anvilcad/target/release/examples/intuit_step_probe"
[[ -x "$probe" ]] || { echo 'REJECT: compiled independent probe missing' >&2; exit 3; }
sha256sum "$probe" >> "$evidence/provenance.log"
python3 conformance/external-cad/anvil_flange.py \
  --bundle "$bundle" --probe "$probe" --source-sha "$actual" \
  --output-dir "$evidence/qualification"
