"""Experimental physical OCP 7.9.3.1 extrusion of SKETCH analytic line/arc profiles.

Reads a versioned, revision-bound analytic-arc-profile/v1; creates genuine
B-rep faces, arcs and bores and performs STEP write and same-engine reimport.
Not pinned OCCT 8.0.1 or independent CAD interoperability. One-shot process.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile

SCHEMA = 'intuit3d/kernel/arc-extrude-v1'
PROFILE = 'intuit3d.analytic-arc-profile'
ID = re.compile(r'^[A-Za-z][A-Za-z0-9_.:-]{0,127}$')
MAX_CURVES = 256
MAX_HOLES = 64


def require(value, message):
    if not value:
        raise ValueError(message)


def num(value, label, *, positive=False):
    require(type(value) in (int, float) and math.isfinite(value), f'{label}: finite number required')
    value = float(value)
    require(abs(value) <= 1e6 and (not positive or 1e-6 <= value), f'{label}: unsupported value')
    return value


def point(value, label):
    require(isinstance(value, dict) and set(value) == {'x', 'y'}, f'{label}: point required')
    return (num(value['x'], f'{label}.x'), num(value['y'], f'{label}.y'))


def nearby(a, b, scale=1):
    return abs(a-b) <= max(1e-7, abs(scale)*1e-10)


def parse_request(obj):
    require(isinstance(obj, dict) and set(obj) == {
        'protocol', 'requestId', 'featureId', 'revision', 'units',
        'thicknessMm', 'profile', 'exportStep'}, 'invalid arc-extrude request schema')
    require(obj['protocol'] == SCHEMA and obj['units'] == 'mm', 'unsupported protocol or units')
    require(all(isinstance(obj[k], str) and ID.fullmatch(obj[k])
                for k in ('requestId', 'featureId')), 'invalid semantic IDs')
    require(type(obj['revision']) is int and 0 <= obj['revision'] < 2**53, 'invalid revision')
    require(type(obj['exportStep']) is bool, 'exportStep must be boolean')
    thickness = num(obj['thicknessMm'], 'thicknessMm', positive=True)
    profile = obj['profile']
    require(isinstance(profile, dict), 'analytic profile required')
    require(profile.get('format') == PROFILE and profile.get('version') == 1 and
            profile.get('units') == 'mm' and
            profile.get('status') == 'analytic_2d_validated_pending_native' and
            profile.get('providerSubmissionReady') is True and
            profile.get('globalSelfIntersectionChecked') is True and
            profile.get('holeContainmentChecked') is True and
            profile.get('nativeProfileAdmissible') is False and
            profile.get('stepQualified') is False, 'unrecognized or unqualified SKETCH profile')
    require(isinstance(profile.get('id'), str) and ID.fullmatch(profile['id']), 'invalid profile ID')
    require(isinstance(profile.get('sourceSignature'), str) and profile['sourceSignature'],
            'missing sketch source signature')
    curves, holes = profile.get('boundary'), profile.get('holes')
    require(isinstance(curves, list) and 4 <= len(curves) <= MAX_CURVES, 'invalid boundary')
    require(isinstance(holes, list) and len(holes) <= MAX_HOLES, 'invalid holes')
    seen = set()
    first = last = None
    signed_area = 0.0
    cylinder_data = []
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire
    from OCP.gp import gp_Pnt, gp_Circ, gp_Ax2, gp_Dir
    wire_builder = BRepBuilderAPI_MakeWire()
    for i, curve in enumerate(curves):
        require(isinstance(curve, dict) and isinstance(curve.get('id'), str) and
                ID.fullmatch(curve['id']) and curve['id'] not in seen,
                f'boundary {i}: invalid or duplicate ID')
        seen.add(curve['id'])
        kind = curve.get('kind')
        require(kind in ('line', 'arc'), f'boundary {i}: unsupported curve')
        start, end = point(curve.get('start'), 'start'), point(curve.get('end'), 'end')
        require(math.dist(start, end) > 1e-8, f'boundary {i}: degenerate edge')
        if i and math.dist(last, start) > 1e-8:
            raise ValueError('boundary is not continuously connected')
        if first is None:
            first = start
        last = end
        if kind == 'line':
            require(set(curve) == {'id', 'kind', 'start', 'end'}, 'invalid line fields')
            edge = BRepBuilderAPI_MakeEdge(gp_Pnt(*start, 0), gp_Pnt(*end, 0)).Edge()
            signed_area += (start[0]*end[1]-end[0]*start[1])/2
        else:
            require(set(curve) == {'id','kind','center','start','end',
                                    'radiusMm','startAngleRad','sweepRad'}, 'invalid arc fields')
            cx, cy = point(curve['center'], 'arc center')
            radius = num(curve['radiusMm'], 'arc radius', positive=True)
            angle = num(curve['startAngleRad'], 'start angle')
            sweep = num(curve['sweepRad'], 'sweep')
            require(1e-6 < abs(sweep) < 2*math.pi-1e-8, 'zero or full-circle arc')
            expected_start = (cx+radius*math.cos(angle), cy+radius*math.sin(angle))
            expected_end = (cx+radius*math.cos(angle+sweep), cy+radius*math.sin(angle+sweep))
            require(math.dist(start,expected_start)<1e-7 and
                    math.dist(end,expected_end)<1e-7, 'arc endpoint disagrees with circle')
            circle = gp_Circ(gp_Ax2(gp_Pnt(cx,cy,0), gp_Dir(0,0,1)),radius)
            if sweep > 0:
                edge = BRepBuilderAPI_MakeEdge(circle,angle,angle+sweep).Edge()
            else:
                edge = BRepBuilderAPI_MakeEdge(circle,angle+sweep,angle).Edge()
                edge.Reverse()
            signed_area += (cx*(end[1]-start[1])-cy*(end[0]-start[0])+radius**2*sweep)/2
            cylinder_data.append((cx,cy,radius))
        wire_builder.Add(edge)
        require(wire_builder.IsDone(), f'boundary {i}: native wire construction failed')
    require(math.dist(first,last)<1e-8, 'open boundary')
    require(signed_area > 1e-6, 'outer contour must have positive signed area')
    seen_holes = set()
    hole_data = []
    for hole in holes:
        require(isinstance(hole,dict) and set(hole)=={'id','centerId','x','y','radiusMm'},
                'invalid hole fields')
        require(isinstance(hole['id'],str) and ID.fullmatch(hole['id']) and
                hole['id'] not in seen_holes, 'duplicate or invalid hole ID')
        seen_holes.add(hole['id'])
        x,y,r = (num(hole['x'],'hole x'),num(hole['y'],'hole y'),
                   num(hole['radiusMm'],'hole radius',positive=True))
        hole_data.append((x,y,r))
    material_area = signed_area - math.fsum(math.pi*r*r for _,_,r in hole_data)
    require(material_area>1e-6, 'nonpositive material area')
    require(nearby(signed_area,num(profile.get('signedBoundaryAreaMm2'),'signed area'),signed_area)
            and nearby(material_area,num(profile.get('materialAreaMm2'),'material area'),material_area),
            'analytic signed/material area does not match source profile')
    return (obj, thickness, wire_builder.Wire(), hole_data,
            cylinder_data, material_area)


def inspect(shape, expected_cylinders, volume_target):
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_SHELL
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
    require(BRepCheck_Analyzer(shape).IsValid(), 'invalid native B-rep')
    def count(t):
        e=TopExp_Explorer(shape,t)
        n=0
        while e.More(): n+=1;e.Next()
        return n
    require(count(TopAbs_SOLID)==1 and count(TopAbs_SHELL)==1, 'incorrect solid or shell count')
    props=GProp_GProps()
    BRepGProp.VolumeProperties_s(shape,props)
    volume=props.Mass()
    require(nearby(volume,volume_target,volume_target), 'native material volume does not match profile')
    cylinders=[]
    exp=TopExp_Explorer(shape,TopAbs_FACE)
    while exp.More():
        s=BRepAdaptor_Surface(TopoDS.Face_s(exp.Current()),True)
        if s.GetType()==GeomAbs_Cylinder:
            c=s.Cylinder(); p=c.Position().Location()
            require(abs(abs(c.Position().Direction().Z())-1)<1e-10,'nonvertical cylinder')
            cylinders.append((p.X(),p.Y(),c.Radius()))
        else: require(s.GetType()==GeomAbs_Plane,'unsupported generated curved face')
        exp.Next()
    require(len(cylinders)==len(expected_cylinders), 'wrong cylindrical face count')
    for want in expected_cylinders:
        found=next((v for v in cylinders if all(abs(a-b)<max(1e-7,abs(b)*1e-9)
                       for a,b in zip(v,want))),None)
        require(found is not None, 'arc or hole cylinder lost/displaced')
        cylinders.remove(found)
    return {'valid':True,'solidCount':1,'shellCount':1,'faceCount':count(TopAbs_FACE),
            'volumeMm3':volume,'cylindricalFaceCount':len(expected_cylinders)}


def execute(request, step_path=None):
    import OCP
    require(OCP.__version__ == '7.9.3.1','not pinned experimental OCP 7.9.3.1')
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace,BRepBuilderAPI_MakeEdge,BRepBuilderAPI_MakeWire
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
    from OCP.gp import gp_Ax2,gp_Circ,gp_Pnt,gp_Dir,gp_Vec
    from OCP.STEPControl import STEPControl_Writer,STEPControl_Reader,STEPControl_ManifoldSolidBrep
    from OCP.IFSelect import IFSelect_RetDone
    obj,thickness,outer,holes,arcs,area = parse_request(request)
    face_builder=BRepBuilderAPI_MakeFace(outer, True)
    require(face_builder.IsDone(), 'outer wire cannot form a planar face')
    for x,y,r in holes:
        circle=gp_Circ(gp_Ax2(gp_Pnt(x,y,0),gp_Dir(0,0,1)),r)
        inner=BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circle).Edge()).Wire()
        inner.Reverse()
        face_builder.Add(inner)
    face_builder.Build()
    require(face_builder.IsDone(),'face with holes invalid')
    shape=BRepPrimAPI_MakePrism(face_builder.Face(),gp_Vec(0,0,thickness),False,True).Shape()
    expected=area*thickness
    source=inspect(shape,arcs+holes,expected)
    artifact=None;readback=None
    if obj['exportStep']:
        require(step_path is not None,'STEP output path required')
        dest=Path(step_path)
        require(not dest.exists(),'STEP output already exists')
        dest.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.intuit3d-arc-',dir=dest.parent) as tmp:
            temp=Path(tmp)/'shape.step'
            writer=STEPControl_Writer()
            require(writer.Transfer(shape,STEPControl_ManifoldSolidBrep)==IFSelect_RetDone,
                    'STEP transfer failed')
            require(writer.Write(str(temp))==IFSelect_RetDone,'STEP write failed')
            reader=STEPControl_Reader()
            require(reader.ReadFile(str(temp))==IFSelect_RetDone and reader.TransferRoots()==1,
                    'STEP same-engine reimport failed')
            readback=inspect(reader.OneShape(),arcs+holes,expected)
            with temp.open('rb') as fp:
                raw=fp.read()
            require(raw.startswith(b'ISO-10303-21;') and len(raw)>256,'missing STEP bytes')
            digest=hashlib.sha256(raw).hexdigest()
            with temp.open('rb+') as fp:
                os.fsync(fp.fileno())
            os.link(temp,dest)
            artifact={'path':str(dest),'bytes':len(raw),'sha256':digest,
                'verification':'OCP-7.9.3.1-same-engine-only'}
    return {'protocol':SCHEMA,'requestId':obj['requestId'],'featureId':obj['featureId'],
            'revision':obj['revision'],'profileId':obj['profile']['id'],
            'sourceSignature':obj['profile']['sourceSignature'],
            'backend':'OCP-python-prototype','occtVersion':'7.9.3.1',
            'status':'experimental_brep','exactAuthority':False,
            'independentInteroperability':False,'units':'mm',
            'source':source,'stepReadback':readback,'artifact':artifact}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--step-output',type=Path)
    args=parser.parse_args()
    try:
        request=json.load(sys.stdin)
        # OCCT's C++ STEP libraries print transfer statistics to FD 1.
        # Temporarily redirect that FD so the IPC stdout contains only JSON.
        sys.stdout.flush()
        saved_stdout=os.dup(1)
        try:
            os.dup2(2,1)
            result=execute(request,args.step_output)
            sys.stdout.flush()
        finally:
            os.dup2(saved_stdout,1)
            os.close(saved_stdout)
        print(json.dumps(result,separators=(',',':'),allow_nan=False))
    except Exception as exc:
        print(json.dumps({'protocol':SCHEMA,'status':'requires_reconciliation',
                          'message':str(exc)},separators=(',',':')))
        return 2
    return 0


if __name__=='__main__':
    sys.exit(main())
