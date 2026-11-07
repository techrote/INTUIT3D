cmake_minimum_required(VERSION 3.20)
project(intuit3d_occt8_plate LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# Reuse exact radiCADSAC RCS-006 headless OCCT ABI; no system fallback.
set(INTUIT3D_OCCT8_PREFIX "" CACHE PATH "Verified OCCT 8.0.1 install")
if(NOT INTUIT3D_OCCT8_PREFIX AND DEFINED ENV{RCS006_OCCT_PREFIX})
  set(INTUIT3D_OCCT8_PREFIX "$ENV{RCS006_OCCT_PREFIX}")
endif()
if(NOT INTUIT3D_OCCT8_PREFIX)
  message(FATAL_ERROR "Set INTUIT3D_OCCT8_PREFIX to verified radiCADSAC RCS-006 install")
endif()
set(_version_header "${INTUIT3D_OCCT8_PREFIX}/include/opencascade/Standard_Version.hxx")
set(_pin_file "${INTUIT3D_OCCT8_PREFIX}/RCS006_SOURCE_PIN.txt")
if(NOT EXISTS "${_version_header}" OR NOT EXISTS "${_pin_file}")
  message(FATAL_ERROR "Missing pinned OCCT version header or source attestation")
endif()
file(STRINGS "${_version_header}" _version_line REGEX "^#define OCC_VERSION_COMPLETE ")
if(NOT "${_version_line}" STREQUAL "#define OCC_VERSION_COMPLETE \"8.0.1\"")
  message(FATAL_ERROR "Unqualified OCCT version: ${_version_line}")
endif()
file(STRINGS "${_pin_file}" _commit_line REGEX "^commit=")
file(STRINGS "${_pin_file}" _profile_line REGEX "^build_profile=")
if(NOT "${_commit_line}" STREQUAL "commit=b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
   OR NOT "${_profile_line}" STREQUAL "build_profile=release-shared-cxx17-worker-only-headless-v4")
  message(FATAL_ERROR "Wrong OCCT source commit or build profile")
endif()
set(_toolkits TKernel TKMath TKG2d TKG3d TKGeomBase TKBRep TKGeomAlgo
              TKTopAlgo TKPrim TKBO TKShHealing TKDE TKXSBase TKDESTEP)
set(_libraries "")
foreach(_toolkit IN LISTS _toolkits)
  find_library(INTUIT3D_${_toolkit}
    NAMES ${_toolkit}
    PATHS "${INTUIT3D_OCCT8_PREFIX}/lib" "${INTUIT3D_OCCT8_PREFIX}/lib64"
    NO_DEFAULT_PATH REQUIRED)
  list(APPEND _libraries "${INTUIT3D_${_toolkit}}")
endforeach()
add_executable(intuit3d_occt8_plate plate_worker.cpp)
target_include_directories(intuit3d_occt8_plate PRIVATE
  "${INTUIT3D_OCCT8_PREFIX}/include/opencascade")
target_link_libraries(intuit3d_occt8_plate PRIVATE ${_libraries})
if(MSVC)
  target_compile_options(intuit3d_occt8_plate PRIVATE /W4 /permissive-)
else()
  target_compile_options(intuit3d_occt8_plate PRIVATE -Wall -Wextra -Wpedantic)
  set_target_properties(intuit3d_occt8_plate PROPERTIES
    BUILD_RPATH "${INTUIT3D_OCCT8_PREFIX}/lib;${INTUIT3D_OCCT8_PREFIX}/lib64")
  # The pinned OCCT 8.0.1 shared toolkits depend on one another. GNU ld's
  # default DT_RUNPATH is only searched for this executable's direct DT_NEEDED
  # entries, not for transitive toolkit dependencies (e.g. TKGeomBase ->
  # TKG2d). Real hosted qualification 42370519769 built the binary but failed
  # at startup on libTKG2d.so.8.0 despite the correct BUILD_RPATH. On Linux,
  # emit DT_RPATH so the same *verified OCCT prefix* also resolves transitive
  # OCCT toolkits. Never add a system OCCT search fallback or change ABI pin.
  if(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND
     CMAKE_CXX_COMPILER_ID MATCHES "^(GNU|Clang)$")
    target_link_options(intuit3d_occt8_plate PRIVATE
      "LINKER:--disable-new-dtags")
  endif()
endif()
