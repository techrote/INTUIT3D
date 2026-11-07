# KERNEL — STEP plate-v1 analytic surface cross-check

**Status:** Experimental OCP 7.9.3.1 AP214 writer compatibility gate; not full ISO 10303-21 interoperability certification.

## What this admits

`verify_step_artifact(path, expected_holes=N, plate=validated_plate)` first checks the existing bounded AP214/mm section, unit, solid, shell and graph contracts, then uses `step_analytic_guard.verify_step_analytic_plate` to read the actual shell-bound AP214 analytic surface definitions using only the Python standard library.

It follows the surface's `AXIS2_PLACEMENT_3D`, `CARTESIAN_POINT` and `DIRECTION` references and refuses inconsistent plate X/Y/Z support-plane offsets, extra/missing surfaces, non-vertical cylinder directions, nonorthogonal placement axes, wrong cylinder XY centres or wrong radii. The six intended plate supports are X = ±width/2, Y = ±depth/2, Z = 0 and thickness. Cylinder placement may use any Z origin along its axis; only its XY and radius are compared here because source/STEP B-rep face-depth and topology guards separately verify actual through-cuts.

**Comparison policy:** maximum of 1e-11 mm absolute and 1e-12 relative for serialised coordinates/radii. Axis classification inherits the plate-v1 1e-10 off-axis component gate; orthogonality uses 1e-10. These are declared numeric **equivalence/refusal budgets**, not Boolean fuzzy tolerances and do not authorize geometry repair. The code does not change OCCT's global settings.

## Execution and limitations

Run `bash native/ci.sh` for actual pinned prototype OCCT geometry + STEP fixtures, including `native/tests/test_step_analytic_guard.py`. This test suite generates real AP214 plate exports for zero, one and two through-holes and mutates their actual serialised geometry and placement references.

The new independent reading path is **only independent of OCCT as a numeric/semantic serialization oracle**; it is not a separate general-purpose STEP geometry engine. It does not reconstruct trims/edges/solids, verify external importer compatibility or prove manufacturing-grade STEP. It only runs after the existing AP214 graph admission, before the separately supervised same-engine STEP reader and digest-fenced exclusive publication. OCP 7.9.3.1 from cadquery-ocp 7.9.3.1.1 remains a research backend, not the planned OCCT 8.0.1 C++ production worker.

The preflight entry point without `plate` remains **structural only** for compatibility. The supervisor intentionally supplies validated plate intent so production-path experimental exports cannot bypass the new numerical gate.

**Disposition:** repair-then-adopt experimental export hardening after exact-head hosted tests and independent Integration review; defer interchange claims pending OCCT 8.0.1 C++ and a distinct full STEP consumer.
