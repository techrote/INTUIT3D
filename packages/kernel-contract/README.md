# @intuit3d/kernel-contract — experimental plate-v1

The browser-safe `@intuit3d/kernel-contract/plate-v1` package validates
versioned, revision-fenced requests and untrusted worker JSON. The **Node-only**
`@intuit3d/kernel-contract/local-plate-provider` subpath now actually launches
the existing isolated `native/run_plate.py` OCP 7.9.3.1 geometry worker.
Neither API claims production OCCT 8.0.1, independent STEP interoperability,
persisted topological lineage, generic CAD solids, or authoritative geometry.

## Real local plate + cut + STEP flow

Requires Node >=22, Python with pinned `cadquery-ocp==7.9.3.1.1` and its
transitive dependencies (see `native/requirements-prototype.txt`).
Run from the repository root after `npm ci`:

~~~js
import {runExperimentalPlate} from '@intuit3d/kernel-contract/local-plate-provider';
import {parsePlateRequest, PLATE_PROTOCOL} from '@intuit3d/kernel-contract/plate-v1';

const request = parsePlateRequest({
  protocol:PLATE_PROTOCOL, requestId:'plate.build.1', featureId:'plate.1',
  revision:1, units:'mm', exportStep:true,
  plate:{width:120,depth:80,thickness:8,holes:[
    {x:-30,y:0,radius:6},{x:30,y:0,radius:6},
  ]},
});
const model = {revision:1};
const result = await runExperimentalPlate(request, {
  readCurrentRevision:() => model.revision,
  stepOutput:'/tmp/intuit3d-example.step', // must not exist
  timeoutMs:30000,
});
console.log(result);
// Success: kind='experimental_report', observed.source and observed.stepReadback
// are real OCP metrics; artifact includes sha256, bytes, exclusive published path.
// exactAuthority=false and independentInteroperability=false ALWAYS.
~~~

Call again with an incremented request revision and edited thickness to rebuild
the plate from authoritative parameters. A changed/missing revision, invalid
native output, failure/timeout, or existing output destination yields an
explicit `unresolved` result. An `AbortSignal` can cancel work and prevent
publication of the temporary export to the requested destination. The child
writes solely to a private temporary path; the Node host rechecks revision and
hash before publishing exclusively via a same-directory hard link. Existing
exports are never overwritten. This is **not** a hostile-worker sandbox,
crash-durable directory transaction, or native Windows process-tree guarantee.

Do not bundle `local-plate-provider` into the React browser: use it only from
a trusted Node desktop/service host once RUNTIME/WORKBENCH has explicitly
admitted a local bridge. Browser code may consume `plate-v1` types, but
must never treat this experimental report as a certified solid/STEP exchange.

## Scope and qualification

- Real OCP generates an analytic exact B-rep box and Boolean cylinder cuts;
  the Python supervisor verifies structure, mass, hole semantics and fresh
  same-engine STEP readback before returning.
- The new Node adapter validates the full request and response again, retains
  source/readback metrics, publishes measured STEP bytes and SHA-256 only for
  current semantic revision, and returns `experimental_report`.
- Native OCP's reported `validated_exact` is **scope-local prototype status**,
  not a claim of exact product authority. Independent full STEP readers and the
  pinned OCCT 8.0.1 C++ production worker are still absent.
- Millimetres, finite binary64 values, strictly interior/disjoint holes (up to
  64), and the narrow numerical checks in `native/protocol.py` apply.
  These comparisons are not fuzzy modelling tolerances.

~~~sh
npm ci
npm run test --workspace @intuit3d/kernel-contract
npm run typecheck --workspace @intuit3d/kernel-contract
bash native/ci.sh
# The last command runs the actual Node -> Python -> OCP -> STEP -> Node tests
# on Linux with pinned experimental OCP installed or provisioned.
~~~

Windows workspace/type tests cannot be described as Windows-native OCP
geometry qualification. Native test setup uses an OCP research wheel rather
than a verified OCCT 8.0.1 C++ toolchain. Integration issue #5 owns workspace
admission and guarded merge. KERNEL issue #3 owns the native implementation.
