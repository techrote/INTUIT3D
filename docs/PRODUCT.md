# INTUIT3D — product brief

## Product identity

INTUIT3D is an offline-first parametric 3D CAD workbench with Fusion-inspired UX, redesigned around **intent first, dependencies second, chronology third**. The user may act in inconvenient or unconventional orders; the engine should retain intent and reconcile constraints/geometry where possible rather than demand a clean modelling history.

## UX principles

1. **Model first, organize later:** introduce parameters, dimensions, references, constraints, grouping and components retrospectively.
2. **Two histories:** the chronological edit log shows what happened; a dependency graph exposes what must evaluate before what.
3. **Hybrid manipulation:** sketch, constrained parametric features, push-pull, imported B-rep edits and direct transforms coexist, without silently breaking editability.
4. **Failure is local and legible:** unsatisfied features remain editable and targetable; last-good geometric snapshots are visibly stale, not authoritative.
5. **Predictable numerical truth:** no fabricated valid geometry and no hidden loss of tiny details, bodies or constraints.
6. **Productive familiarity:** toolbar workspaces, model browser, viewport, inspector, command search, context actions, timeline and dependency view.
7. **Keyboard and mouse equally capable:** keyboard-first commands, precise input, snapping and manipulators, selection filters, useful undo/redo.
8. **Local ownership:** files open, save and export locally; no sign-in, telemetry or cloud computation.

## First end-to-end demonstration

Sketch a rectangle; make a parametric plate; extrude; sketch two holes and cut them; move a reference; edit early dimensions; reorder independent features; create a temporarily unsatisfied reference and recover; save and reopen; reconstruct; export a validated STEP and compare analytic volume/body count.

## Long-term capability coverage

Sketch: precision curves, lines, arcs, splines, construction, projected and imported geometry; constraints, dimensions, expressions, profiles and DOF.

Solid/surface: extrude, cut, revolve, sweep, loft, shell, fillet/chamfer, draft, split, mirror, patterns, surface patch and sewing.

Assemblies: reusable components, joints, mating, configuration and interference.

Engineering: measurements, mass properties, drawings, BOM, STEP and other qualified format exchange.

CAM/simulation/collaboration are later extensions, not dependencies of the modelling core.

## Scope discipline

Build a thin working vertical slice early, then deepen it with adversarial edit history and reference-remapping tests. Breadth must never cause silently false engineering output. UI aesthetic inspiration is not permission to copy proprietary artwork, trademarks or software.
