#!/usr/bin/env bash
# Execute genuine independent BRL-CAD STEP import against original INTUIT3D STEP bytes.
# SourceForge 7.44.0 amd64 DEB and digest are pinned to the distributor's file page.
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: bash conformance/external-cad/run-pinned-brlcad.sh --bundle ARTIFACT.zip --evidence-dir FRESH_DIR [--deb LOCAL_7440.deb]

Requires: Linux amd64, bash, curl (unless --deb), dpkg-deb, sha256sum,
          python3, and enough free space to extract the BRL-CAD DEB.
The original STEP ZIP must contain flange.four.step, flange.thick.step,
flange.five.step and flange.undo.step with hashes pinned in flange-cases.json.
No OCCT, pythonOCC or synthetic CLI is an independent importer.
USAGE
}

bundle='' evidence='' local_deb=''
while (($#)); do
  case "$1" in
    --bundle|--evidence-dir|--deb)
      if (($# < 2)); then usage >&2; exit 2; fi
      case "$1" in
        --bundle) bundle=$2;;
        --evidence-dir) evidence=$2;;
        --deb) local_deb=$2;;
      esac
      shift 2;;
    -h|--help) usage; exit 0;;
    *) printf 'Unexpected option: %s\n' "$1" >&2; usage >&2; exit 2;;
  esac
done
if [[ -z "$bundle" || -z "$evidence" ]]; then usage >&2; exit 2; fi
if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  printf 'REJECT: BRL-CAD 7.44.0 artifact is Linux x86_64 only\n' >&2; exit 3
fi
for tool in python3 dpkg-deb sha256sum find; do command -v "$tool" >/dev/null || { echo "REJECT: missing $tool" >&2; exit 3; }; done
if [[ -e "$evidence" ]]; then printf 'REJECT: evidence directory already exists: %s\n' "$evidence" >&2; exit 3; fi
if [[ ! -f "$bundle" ]]; then printf 'REJECT: original ZIP not found: %s\n' "$bundle" >&2; exit 3; fi
mkdir -p "$evidence/toolchain"

# The distributor's SHA-256 is independently published at:
# https://sourceforge.net/projects/brlcad/files/BRL-CAD%20for%20Linux/7.44.0/brlcad_7.44.0-0_amd64.deb/download
url='https://sourceforge.net/projects/brlcad/files/BRL-CAD%20for%20Linux/7.44.0/brlcad_7.44.0-0_amd64.deb/download'
expected_sha='ef2b5e33b24eea7437f18d0d95798b6f6e8c6666a5369aac14f1183d8caa259c'
deb="$evidence/toolchain/brlcad_7.44.0-0_amd64.deb"
if [[ -n "$local_deb" ]]; then
  if [[ ! -f "$local_deb" ]]; then echo "REJECT: local DEB missing: $local_deb" >&2; exit 3; fi
  cp -- "$local_deb" "$deb"
else
  command -v curl >/dev/null || { echo 'REJECT: missing curl' >&2; exit 3; }
  curl --fail --location --retry 3 --connect-timeout 25 --max-time 600 --output "$deb" "$url"
fi
printf '%s  %s\n' "$expected_sha" "$deb" | sha256sum --check --status || {
  echo 'REJECT: downloaded/local BRL-CAD DEB does not match distributor SHA-256' >&2
  exit 3
}
printf 'BRL-CAD DEB SHA-256 PASS: %s\n' "$expected_sha"

prefix="$evidence/toolchain/unpacked"
mkdir -p "$prefix"
dpkg-deb --extract "$deb" "$prefix"
find_bin() {
  local p
  p=$(find "$prefix" -name "$1" \( -type f -o -type l \) -print -quit)
  if [[ -z "$p" || ! -x "$p" ]]; then
    printf 'REJECT: required BRL-CAD executable %s missing or not executable\n' "$1" >&2
    exit 3
  fi
  printf '%s' "$p"
}
step_g=$(find_bin step-g)
mged=$(find_bin mged)
gqa=$(find_bin gqa)
nirt=$(find_bin nirt)
# Honor the package's private shared libraries without requiring a root install.
private_lib=$(find "$prefix" -name 'libbu.so*' -type f -printf '%h\n' -quit)
if [[ -n "$private_lib" ]]; then
  export LD_LIBRARY_PATH="$private_lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export PATH="$(dirname "$step_g"):$(dirname "$mged"):$(dirname "$gqa"):$(dirname "$nirt"):$PATH"
{
  printf 'Distributor: BRL-CAD 7.44.0 Linux amd64\n'
  printf 'Debian artifact SHA-256: %s\n' "$expected_sha"
  for bin in "$step_g" "$mged" "$gqa" "$nirt"; do
    sha256sum "$bin"
    ldd "$bin" || true
  done
  "$step_g" --help || true
} > "$evidence/toolchain/provenance.log" 2>&1

# The original harness creates qualification/ as a fresh immutable directory.
# It validates each STEP SHA before invoking *real* non-OCCT importer/ray tools.
python3 conformance/external-cad/brlcad_flange.py \
  --bundle "$bundle" \
  --output-dir "$evidence/qualification" \
  --step-g "$step_g" --mged "$mged" --gqa "$gqa" --nirt "$nirt"

printf 'Original artifact SHA-256: '
sha256sum "$bundle"
echo 'Independent CAD import completed; inspect qualification/qualification.json and raw logs.'
