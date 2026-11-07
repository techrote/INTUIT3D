"""Isolated experimental OCP 7.9.3.1 Boolean cut of two admitted SKETCH profiles.

Real separate target and cutting solids, analytic removed mass, STEP bytes, same-engine
readback and exclusive publication. Never claim pinned OCCT8 C++ or independent CAD.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile

from analytic_profile_extrude import parse_request, require, nearby, ID

SCHEMA = 'intuit3d/kernel/profile-body-cut-v1'
POCKET_SCHEMA = 'intuit3d/kernel/profile-body-cut-v2'


def _face(parsed):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire
    from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2, gp_Circ
    _, _, wire, holes, _, _ = parsed
    maker = BRepBuilderAPI_MakeFace(wire, True)
    require(maker.IsDone(), 'invalid profile boundary face')
    for x, y, radius in holes:
        circle = gp_Circ(gp_Ax2(gp_Pnt(x, y, 0), gp_Dir(0, 0, 1)), radius)
        inner = BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circle).Edge()).Wire()
        inner.Reverse()
        maker.Add(inner)
    maker.Build()
    require(maker.IsDone(), 'profile with holes cannot form a face')
    return maker.Face()


def _shape(parsed, height, z_offset=0):
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    from OCP.gp import gp_Vec, gp_Trsf
    shape = BRepPrimAPI_MakePrism(_face(parsed), gp_Vec(0, 0, height), False, True).Shape()
    if z_offset:
        transform = gp_Trsf()
        transform.SetTranslation(gp_Vec(0, 0, z_offset))
        shape = BRepBuilderAPI_Transform(shape, transform, True).Shape()
    return shape


def _measure(shape):
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    require(not shape.IsNull() and BRepCheck_Analyzer(shape).IsValid(), 'invalid Boolean B-rep')
    def count(kind):
        iterator = TopExp_Explorer(shape, kind)
        result = 0
        while iterator.More():
            result += 1
            iterator.Next()
        return result
    solids, shells = count(TopAbs_SOLID), count(TopAbs_SHELL)
    require(solids == 1 and shells == 1, 'Boolean cut did not preserve a single solid')
    mass = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, mass)
    require(math.isfinite(mass.Mass()) and mass.Mass() > 0, 'invalid Boolean mass')
    return {'valid': True, 'solidCount': solids, 'shellCount': shells,
            'faceCount': count(TopAbs_FACE), 'volumeMm3': mass.Mass()}


def execute(request, step_path=None):
    import OCP
    require(OCP.__version__ == '7.9.3.1', 'requires pinned experimental OCP 7.9.3.1')
    require(isinstance(request, dict), 'body cut request must be an object')
    schema = request.get('protocol')
    require(schema in (SCHEMA, POCKET_SCHEMA), 'unsupported body cut protocol')
    keys = {'protocol', 'requestId', 'cutFeatureId', 'targetBodyId',
            'revision', 'units', 'baseExtrude', 'cutTool', 'exportStep'}
    if schema == POCKET_SCHEMA:
        keys.add('cutDepthMm')
    require(set(request) == keys and request['units'] == 'mm',
            'invalid body cut request fields or units')
    require(all(isinstance(request[key], str) and ID.fullmatch(request[key])
                for key in ('requestId', 'cutFeatureId', 'targetBodyId')),
            'invalid cut, body or request identity')
    require(type(request['revision']) is int and 0 <= request['revision'] < 2**53,
            'invalid document revision')
    require(type(request['exportStep']) is bool, 'exportStep must be boolean')
    base, cutter = request['baseExtrude'], request['cutTool']
    require(isinstance(base, dict) and isinstance(cutter, dict), 'paired authored profiles required')
    for part in (base, cutter):
        require(part.get('revision') == request['revision'] and
                part.get('units') == 'mm' and part.get('exportStep') is False,
                'profile is stale or independently publishing an intermediate STEP')
    require(base.get('featureId') != cutter.get('featureId') and
            request['cutFeatureId'] not in (base.get('featureId'), cutter.get('featureId')),
            'separate extrusion and cut identities required')
    base_parsed, cut_parsed = parse_request(base), parse_request(cutter)
    thickness = base_parsed[1]
    cut_depth = thickness
    if schema == POCKET_SCHEMA:
        depth = request['cutDepthMm']
        require(type(depth) in (int, float) and math.isfinite(depth) and
                1e-6 <= depth <= thickness, 'pocket depth must be positive and within base thickness')
        cut_depth = float(depth)
    require(nearby(cut_parsed[1], thickness, thickness),
            'cut depth must match the through-body extrusion depth')
    require(not cut_parsed[3], 'cut profile holes are not supported in v1')
    base_area, cut_area = base_parsed[5], cut_parsed[5]
    require(base_area > cut_area and cut_area > 1e-6,
            'cut must remove a smaller positive material region')
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.STEPControl import STEPControl_Writer, STEPControl_Reader, STEPControl_ManifoldSolidBrep
    from OCP.IFSelect import IFSelect_RetDone
    target = _shape(base_parsed, thickness)
    # Overshoot the open top; for a blind pocket stop at the authored
    # floor. A full-depth cut overshoots the bottom to avoid coplanarity.
    start_z = thickness - cut_depth if cut_depth < thickness else -thickness
    tool = _shape(cut_parsed, 3 * thickness, start_z)
    before = _measure(target)
    require(nearby(before['volumeMm3'], base_area * thickness, base_area * thickness),
            'base solid has wrong physical volume')
    boolean = BRepAlgoAPI_Cut(target, tool)
    boolean.SetFuzzyValue(0.0)
    boolean.SetRunParallel(False)
    boolean.Build()
    require(boolean.IsDone() and not boolean.Shape().IsNull(),
            'explicit body cut failed')
    shape = boolean.Shape()
    source = _measure(shape)
    expected = base_area * thickness - cut_area * cut_depth
    require(nearby(source['volumeMm3'], expected, expected),
            'cut did not remove the full intended area of the target body')
    step_readback = None
    artifact = None
    if request['exportStep']:
        require(step_path is not None, 'STEP destination required')
        dest = Path(step_path)
        require(not dest.exists(), 'STEP output already exists')
        dest.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.intuit3d-cut-', dir=dest.parent) as folder:
            staged = Path(folder) / 'physical-cut.step'
            writer = STEPControl_Writer()
            require(writer.Transfer(shape, STEPControl_ManifoldSolidBrep) == IFSelect_RetDone and
                    writer.Write(str(staged)) == IFSelect_RetDone, 'STEP export failed')
            reader = STEPControl_Reader()
            require(reader.ReadFile(str(staged)) == IFSelect_RetDone and
                    reader.TransferRoots() == 1, 'same-engine STEP import failed')
            step_readback = _measure(reader.OneShape())
            require(nearby(step_readback['volumeMm3'], expected, expected),
                    'STEP import does not preserve removed material')
            data = staged.read_bytes()
            require(data.startswith(b'ISO-10303-21;') and len(data) > 256, 'invalid STEP data')
            digest = hashlib.sha256(data).hexdigest()
            with staged.open('rb+') as handle:
                os.fsync(handle.fileno())
            os.link(staged, dest)
            artifact = {'path': str(dest), 'bytes': len(data), 'sha256': digest,
                        'verification': 'OCP-7.9.3.1-same-engine-only'}
    return {'protocol': schema, 'requestId': request['requestId'],
            'cutFeatureId': request['cutFeatureId'], 'targetBodyId': request['targetBodyId'],
            'baseFeatureId': base['featureId'], 'cutToolFeatureId': cutter['featureId'],
            'revision': request['revision'], 'units': 'mm',
            'backend': 'OCP-python-prototype', 'occtVersion': '7.9.3.1',
            'status': 'experimental_body_cut_brep', 'exactAuthority': False,
            'independentInteroperability': False, 'baseVolumeMm3': before['volumeMm3'],
            'removedVolumeMm3': cut_area * cut_depth,
            'analyticResultVolumeMm3': expected,
            'source': source, 'stepReadback': step_readback, 'artifact': artifact,
            **({'cutDepthMm': cut_depth,
                'cutKind': 'blind_pocket' if cut_depth < thickness else 'through'}
               if schema == POCKET_SCHEMA else {})}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--step-output', type=Path)
    args = parser.parse_args()
    try:
        request = json.load(sys.stdin)
        sys.stdout.flush()
        stdout = os.dup(1)
        try:
            os.dup2(2, 1)
            result = execute(request, args.step_output)
            sys.stdout.flush()
        finally:
            os.dup2(stdout, 1)
            os.close(stdout)
        print(json.dumps(result, separators=(',', ':'), allow_nan=False))
        return 0
    except Exception as exc:
        print(json.dumps({'protocol': SCHEMA, 'status': 'requires_reconciliation',
                          'message': str(exc)}, separators=(',', ':')))
        return 2


if __name__ == '__main__':
    sys.exit(main())
