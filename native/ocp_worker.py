"""Experimental OCCT B-rep plate worker through OCP Python bindings.

One job per subprocess. This is real OCCT geometry, but not the planned
pinned OCCT 8.0.1 C++ production worker. Do not conflate qualifications.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from protocol import validate_request, analytic_invariants, close
from plate_envelope import require_plate_vertex_envelope_mm, vertex_envelope_mm
from through_hole_guard import require_through_cylindrical_faces
from plate_topology import require_plate_face_shell_topology


def solid_properties(shape) -> dict:
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder
    from OCP.TopAbs import TopAbs_FACE

    is_valid = not shape.IsNull() and bool(BRepCheck_Analyzer(shape).IsValid())
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    solid_count = 0
    while explorer.More():
        solid_count += 1
        explorer.Next()
    volume_props, area_props = GProp_GProps(), GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, volume_props)
    BRepGProp.SurfaceProperties_s(shape, area_props)
    # Inspect topology independently of aggregate mass. Small holes can be lost
    # while total volume remains inside a deceptively broad floating tolerance.
    cylinders = []
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    while faces.More():
        adapter = BRepAdaptor_Surface(TopoDS.Face_s(faces.Current()))
        if adapter.GetType() == GeomAbs_Cylinder:
            cylinder = adapter.Cylinder()
            centre = cylinder.Position().Location()
            axis = cylinder.Position().Direction()
            cylinders.append({"x": centre.X(), "y": centre.Y(), "radius": cylinder.Radius(), "axisZ": axis.Z()})
        faces.Next()
    cylinders.sort(key=lambda h: (h["x"], h["y"], h["radius"]))
    # A real blind micro-hole can pass area/volume, cylinder count and box
    # extrema. Inspect the actual curved face boundary vertices before any
    # producer or separate STEP reader may claim validated_exact.
    require_through_cylindrical_faces(shape)
    # Scalar accuracy and one-solid checks can miss a microscopic inner void.
    # Enforce the intentionally narrow plate-v1 face/shell inventory in both
    # the source worker and the separately supervised STEP reader.
    require_plate_face_shell_topology(shape)
    return {"valid": is_valid, "solidCount": solid_count, "volumeMm3": volume_props.Mass(), "surfaceAreaMm2": area_props.Mass(), "cylindricalHoles": cylinders}


def build_plate(plate):
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2

    w, d, t = plate["width"], plate["depth"], plate["thickness"]
    shape = BRepPrimAPI_MakeBox(gp_Pnt(-w / 2, -d / 2, 0), w, d, t).Shape()
    for hole in plate["holes"]:
        # Extend cutters past both faces; avoid coincident Boolean end faces.
        cutter = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(hole["x"], hole["y"], -t), gp_Dir(0, 0, 1)), hole["radius"], 3 * t).Shape()
        operation = BRepAlgoAPI_Cut(shape, cutter)
        operation.Build()
        if not operation.IsDone():
            raise RuntimeError("OCCT Boolean cut did not complete")
        shape = operation.Shape()
    return shape


def save_and_reopen(shape, step_file: Path):
    from OCP.STEPControl import STEPControl_Writer, STEPControl_Reader, STEPControl_AsIs
    from OCP.IFSelect import IFSelect_RetDone
    writer = STEPControl_Writer()
    if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone:
        raise RuntimeError("STEP transfer failed")
    if writer.Write(str(step_file)) != IFSelect_RetDone:
        raise RuntimeError("STEP write failed")
    reader = STEPControl_Reader()
    if reader.ReadFile(str(step_file)) != IFSelect_RetDone or reader.TransferRoots() != 1:
        raise RuntimeError("STEP internal reimport failed")
    return reader.OneShape()


def execute(request, step_file: Path):
    import OCP
    shape = build_plate(request["plate"])
    source = solid_properties(shape)
    # Structural validity and aggregate mass alone admit alternate box dimensions.
    # Fail closed on the actual source B-rep envelope before treating it as exact.
    require_plate_vertex_envelope_mm(request["plate"], vertex_envelope_mm(shape), "source")
    step = None
    if request["exportStep"]:
        step = solid_properties(save_and_reopen(shape, step_file))
    target_v, target_a = analytic_invariants(request["plate"])
    good = all((metrics["valid"] is True and metrics["solidCount"] == 1 and close(metrics["volumeMm3"], target_v) and close(metrics["surfaceAreaMm2"], target_a)) for metrics in (source, step) if metrics is not None)
    # The supervisor additionally validates the radius/centre/axis of every
    # expected through-hole, in source and STEP read-back, before admission.
    return {
        "protocol": request["protocol"], "requestId": request["requestId"], "featureId": request["featureId"], "revision": request["revision"],
        "backend": "OCP-python-prototype", "occtVersion": str(OCP.__version__), "status": "validated_exact" if good else "requires_reconciliation",
        "units": "mm", "source": source, "stepReadback": step, "stepWritten": bool(request["exportStep"] and step_file.is_file()),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--response', required=True, type=Path)
    parser.add_argument('--step', required=True, type=Path)
    args = parser.parse_args()
    request = validate_request(json.loads(args.request.read_text(encoding='utf-8')))
    response = execute(request, args.step)
    # Response is written atomically and separately from noisy OCCT stdout.
    staging = args.response.with_suffix('.pending')
    staging.write_text(json.dumps(response, allow_nan=False), encoding='utf-8')
    staging.replace(args.response)
    if response["status"] != "validated_exact":
        raise RuntimeError("OCCT geometry did not satisfy all declared validation gates")


if __name__ == '__main__':
    main()
