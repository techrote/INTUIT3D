# SKETCH — editable rounded plate with analytic arcs, v1

**Product slice / issue:** [SKETCH-002 #63](https://github.com/techrote/INTUIT3D/issues/63).

**Module:** @intuit3d/sketch/rounded-plate/v1. This implements a bounded *constructive*, line-and-arc, tangent rounded-rectangle family. It is not a general nonlinear solver, fillet B-rep, STEP exporter, or exact-predicate curved contact oracle.

Authoritative inputs are (1) the existing fully constrained SKETCH v1 rectangle with optional circular holes, and (2) a separately serializable version-1 RoundedPlateIntent containing a durable semantic ID, four ordered directed rectangle edge IDs, optional circle IDs, and a positive corner radius in mm. IDs remain stable through independent edits of rectangle width, height, radius and save/reopen. Invalid or unresolved source constraints retain intent and produce no fabricated curved profile.

## Runnable consumer example

    import {plateSketchFixture,editConstraint} from '@intuit3d/sketch';
    import {createRoundedPlateIntent,editRoundedPlateRadius,solveRoundedPlate}
      from '@intuit3d/sketch/rounded-plate/v1';

    const sketch=plateSketchFixture();
    const intent=createRoundedPlateIntent({
      version:1,id:'fillet:plate',
      edgeIds:['bottom','right','top','left'],
      holeIds:['holeA','holeB'],radiusMm:8
    });
    const first=solveRoundedPlate(sketch,intent);
    const revised=solveRoundedPlate(
      editConstraint(sketch,'width',{value:140}),
      editRoundedPlateRadius(intent,12)
    );

Run from repository root:

    node --test packages/sketch/test/rounded-plate.test.mjs
    npm run typecheck -w @intuit3d/sketch

The returned status is 'solved' **only for this constructive right-angle family**, because quarter-circle centers, endpoints and orthogonal tangents are determined algebraically. The generalNonlinearSolver field is explicitly false. Each curve retains stable semantic identity derived from authored rectangle vertex/edge IDs; every arc includes a center, radius, start point, end point and angular sweep. The boundary contains **four actual analytic arcs** and four trimmed line segments; no arc has been approximated by unrelated line segments. Circle hole locations and net analytic area are carried through the solution.

A fully constrained rectangular base is mandatory; rotated profiles, arbitrary arcs and unresolved constraints are explicitly unsupported. Finite-representability, corner radius, hole/corner clearance and degenerate straight-line checks fail closed with null geometry. The curved clearance check uses an **explicit conservative numerical budget** of max(1e-9 mm, 1e-12 times the largest dimension); it is not independently qualified as exact curved geometry.

## Honest integration state

Results identify analytic_curved_profile_only, previewOnly:true, and solverKind:constructive_right_angle_fillet_only. The experimental native plate provider currently accepts unfilleted rectangle/circle contracts; it must not be passed this new curved profile until KERNEL offers an explicit curve-aware contract with exact OCCT wire/face admission, Boolean validation and independent STEP read-back.

This is a useful preview and sketch-geometry capability, and part of #63. The broader issue remains open for a pinned, executed general nonlinear solver (including arbitrary tangency, DOF/conflicts), genuine browser curve interaction and qualified exact solid geometry. No dependency or shared-workspace change is introduced.
