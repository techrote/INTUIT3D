# @intuit3d/kernel-contract — plate-v1 experimental provider boundary

This **versioned, typed and executable** package is a narrow consumer contract
for the real `native/run_plate.py` OCP 7.9.3.1 plate/through-hole prototype.
It does **not** implement a geometric kernel or a local process transport.
No browser may use this module's positive JSON classification as permission to
claim an authoritative solid, export independently verified STEP, or display a
fresh exact body. The output deliberately uses `experimental_report`, never
`validated_exact`. A production provider must add independent artifact
attestation, versioned tolerance channels, crash/deadline containment, and
source-specific geometry verification.

## Consumer usage

~~~js
import { parsePlateRequest, assessPlateResponse } from '@intuit3d/kernel-contract/plate-v1';
const request = parsePlateRequest(authoritativeIntent);
const report = assessPlateResponse(request, untrustedWorkerJson,
  {currentRevision: authoritativeModel.revision});
// report.kind === 'experimental_report' is still NOT exact CAD authority.
// report.kind === 'unresolved' preserves a visible pending/error state.
~~~

The request shape deliberately mirrors `native/protocol.py` at main
`2afe0835056583c5d180f68b26ee949f9e2e2618` and its `plate-v1` fixture.
Admission is strictly millimetres and binary64 finite numbers, with 1e-6 mm
minimum dimension/radius, 1e6 mm maximum, up to 64 strictly interior,
non-overlapping holes, and safe nonnegative revision. It mirrors Python's
*declared scalar comparison budgets* of `max(1e-7 mm^n, target × 1e-10)` for
aggregate metrics and `max(1e-11 mm, coordinate × 1e-9)` for bore coordinates.
These are narrow **serialization/report checks**, not design, manufacturing or
Boolean fuzz tolerances. This adapter does not inspect the actual B-rep, STEP
bytes, STEP hash, shell structure, face trims, hidden cavities or filesystem.

## Qualification / integration

~~~sh
npm run test --workspace @intuit3d/kernel-contract
npm run typecheck --workspace @intuit3d/kernel-contract
~~~

These tests can also run in this package without installing third-party
libraries: `node --test test