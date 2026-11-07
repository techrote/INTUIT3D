#!/usr/bin/env bash
# Reproducible pinned OCCT 8.0.1 one-shot worker bootstrap, Linux x86_64.
# Deliberately no default package-version fallback or shared CI mutation.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIN="b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
DEPS="${INTUIT3D_OCCT8_DEPS:-$ROOT/.deps/occt8}"
SRC="$DEPS/occt-src"
BUILD="$DEPS/occt-build"
PREFIX="${INTUIT3D_OCCT8_PREFIX:-$DEPS/occt-8.0.1}"
WORKER_BUILD="$DEPS/worker-build"
JOBS="${INTUIT3D_OCCT8_JOBS:-2}"
mkdir -p "$DEPS"
if [[ ! -d "$SRC/.git" ]]; then
  git clone --filter=blob:none --no-checkout \
    https://github.com/Open-Cascade-SAS/OCCT.git "$SRC"
fi
git -C "$SRC" fetch --depth=1 origin "$PIN"
git -C "$SRC" checkout --detach "$PIN"
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$PIN" ]] || {
  echo "OCCT source pin mismatch" >&2; exit 2;
}
TOOLKITS="TKernel;TKMath;TKG2d;TKG3d;TKGeomBase;TKBRep;TKGeomAlgo;TKTopAlgo;TKPrim;TKBO;TKShHealing;TKDE;TKXSBase;TKDESTEP"
cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_CPP_STANDARD=C++17 \
  -DBUILD_LIBRARY_TYPE=Shared \
  -DBUILD_MODULE_FoundationClasses=OFF \
  -DBUILD_MODULE_ModelingData=OFF \
  -DBUILD_MODULE_ModelingAlgorithms=OFF \
  -DBUILD_MODULE_ApplicationFramework=OFF \
  -DBUILD_MODULE_DataExchange=OFF \
  -DBUILD_MODULE_Visualization=OFF \
  -DBUILD_MODULE_Draw=OFF \
  "-DBUILD_ADDITIONAL_TOOLKITS=$TOOLKITS" \
  -DUSE_TCL=OFF -DUSE_TK=OFF -DUSE_FREETYPE=OFF \
  -DUSE_FREEIMAGE=OFF -DUSE_TBB=OFF -DUSE_VTK=OFF \
  -DUSE_OPENVR=OFF -DUSE_RAPIDJSON=OFF -DUSE_DRACO=OFF \
  -DUSE_FFMPEG=OFF -DUSE_EIGEN=OFF -DUSE_OPENGL=OFF -DUSE_XLIB=OFF
cmake --build "$BUILD" --parallel "$JOBS"
cmake --install "$BUILD"
cat > "$PREFIX/RCS006_SOURCE_PIN.txt" <<EOF
repository=https://github.com/Open-Cascade-SAS/OCCT.git
commit=$PIN
version=8.0.1
build_profile=release-shared-cxx17-worker-only-headless-v4
selected_toolkits=$TOOLKITS
xlib=off
opengl=off
EOF
cmake -S "$ROOT/native/occt8" -B "$WORKER_BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DINTUIT3D_OCCT8_PREFIX="$PREFIX"
cmake --build "$WORKER_BUILD" --parallel "$JOBS"
echo "INTUIT3D_OCCT8_WORKER=$WORKER_BUILD/intuit3d_occt8_plate"
echo "Run native tests using:"
echo "  INTUIT3D_OCCT8_WORKER=$WORKER_BUILD/intuit3d_occt8_plate python3 -m unittest discover -s native/tests -p test_occt8_bridge.py -v"
