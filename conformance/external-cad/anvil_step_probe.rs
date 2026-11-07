//! Independent AnvilCAD anvil-step (not OCCT/OCP) plate geometry sampler.
//! Compiled as an extra example in the immutable third-party checkout at runtime.
//! Binary stdout consists of MACHINE-parseable evidence; nonzero == NOT QUALIFIED.
use anvil_step::{import, Mesh};
use std::collections::HashMap;
use std::env;
use std::fs;

fn fail(reason: &str) -> ! { eprintln!("NOT_QUALIFIED: {reason}"); std::process::exit(3) }
fn number(s: &str) -> f64 {
    let v = s.parse::<f64>().unwrap_or_else(|_| fail("invalid numeric argument"));
    if !v.is_finite() { fail("nonfinite numeric argument") }
    v
}
fn point(m: &Mesh, i: u32) -> [f64;3] {
    *m.vertices.get(i as usize).unwrap_or_else(|| fail("invalid mesh triangle vertex"))
}
fn intersections(m: &Mesh, x: f64, y: f64) -> Vec<f64> {
    let mut zs = Vec::new();
    for triangle in m.faces.iter().flat_map(|face| &face.triangles) {
        let a=point(m,triangle[0]); let b=point(m,triangle[1]); let c=point(m,triangle[2]);
        let ux=b[0]-a[0]; let uy=b[1]-a[1];
        let vx=c[0]-a[0]; let vy=c[1]-a[1];
        let det=ux*vy-uy*vx;
        if det.abs()<1e-12 { continue; }
        let px=x-a[0]; let py=y-a[1];
        let u=(px*vy-py*vx)/det; let v=(ux*py-uy*px)/det;
        if u >= -1e-9 && v >= -1e-9 && u+v <= 1.0+1e-9 {
            let z=a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
            if !z.is_finite() { fail("nonfinite ray intersection") }
            zs.push(z);
        }
    }
    zs.sort_by(f64::total_cmp);
    zs.dedup_by(|a,b| (*a-*b).abs()<1e-5);
    zs
}
fn main() {
    let args:Vec<String>=env::args().collect();
    if args.len()!=6 { fail("usage: intuit_step_probe INPUT.step WIDTH DEPTH THICKNESS x,y,r;x,y,r;..."); }
    let width=number(&args[2]); let depth=number(&args[3]); let thickness=number(&args[4]);
    if !(width>0.0 && depth>0.0 && thickness>0.0) { fail("invalid plate dimensions"); }
    let holes:Vec<(f64,f64,f64)>=args[5].split(';').map(|h| {
        let v:Vec<&str>=h.split(',').collect();
        if v.len()!=3 { fail("expected hole x,y,r"); }
        let (x,y,r)=(number(v[0]),number(v[1]),number(v[2]));
        if !(r>0.0) { fail("nonpositive hole radius"); }
        (x,y,r)
    }).collect();
    if holes.len()<2 { fail("expected a meaningful set of bore probes"); }
    let source=fs::read_to_string(&args[1]).unwrap_or_else(|_| fail("cannot read actual STEP"));
    let cad=import(&source).unwrap_or_else(|e| fail(&format!("anvil-step import failed: {e}")));
    if cad.length_unit!="millimetre" && cad.length_unit!="millimeter" {
        fail(&format!("STEP units not independently recognized as mm: {}",cad.length_unit));
    }
    let solids:Vec<_>=cad.bodies.iter().filter(|b|b.solid).collect();
    if solids.len()!=1 || cad.bodies.len()!=1 { fail("import did not reconstruct precisely one solid body"); }
    let body=solids[0]; let mesh=&body.mesh;
    // A triangulated fallback is insufficient: this gate requires independently
    // reconstructed analytic topology, with no suppressed STEP import warnings.
    if body.exact.is_none() { fail("STEP did not reconstruct an exact B-rep"); }
    if !cad.warnings.is_empty() {
        fail(&format!("STEP import emitted {} warnings", cad.warnings.len()));
    }
    if mesh.vertices.is_empty() || mesh.faces.is_empty() { fail("empty reconstructed mesh"); }
    let mut oriented:HashMap<(u32,u32),usize>=HashMap::new();
    let mut signed_volume=0.0f64;
    let mut tris=0;
    for tri in mesh.faces.iter().flat_map(|f| &f.triangles) {
        let a=point(mesh,tri[0]); let b=point(mesh,tri[1]); let c=point(mesh,tri[2]); tris+=1;
        let cross=[
            b[1]*c[2]-b[2]*c[1],
            b[2]*c[0]-b[0]*c[2],
            b[0]*c[1]-b[1]*c[0]
        ];
        signed_volume+=(a[0]*cross[0]+a[1]*cross[1]+a[2]*cross[2])/6.0;
        for k in 0..3 { *oriented.entry((tri[k],tri[(k+1)%3])).or_default()+=1; }
    }
    if tris<8 || !signed_volume.is_finite() { fail("invalid triangle surface"); }
    let unpaired=oriented.iter().filter(|((a,b),n)| **n!=1 || oriented.get(&(*b,*a))!=Some(&1)).count();
    if unpaired>0 { fail(&format!("unpaired directed mesh edges: {unpaired}")); }
    let volume=signed_volume.abs();
    let wanted=(width*depth-holes.iter().map(|h|std::f64::consts::PI*h.2*h.2).sum::<f64>())*thickness;
    if wanted<=0.0 || (volume-wanted).abs()>wanted*0.01 {
        fail(&format!("independent imported triangle-volume mismatch: {volume} vs {wanted} mm3"));
    }
    let mut probes:Vec<(String,f64,f64,bool)>=holes.iter().enumerate().map(|(i,h)|
        (format!("hole.{i}"),h.0,h.1,false)).collect();
    for (name,x,y) in [
       ("solid.nw",-width/6.0,-depth/6.0),("solid.ne",width/6.0,-depth/6.0),
       ("solid.sw",-width/6.0,depth/6.0),("solid.se",width/6.0,depth/6.0)
    ] { probes.push((name.to_string(),x,y,true)); }
    probes.push(("exterior".into(),width/2.0+10.0,0.0,false));
    if !holes.iter().any(|h|h.0.abs()<1e-9 && h.1.abs()<1e-9) {
        probes.push(("central.material".into(),0.0,0.0,true));
    }
    for (name,x,y,material) in probes {
        let zs=intersections(mesh,x,y);
        if material {
            if zs.len()!=2 || zs[0].abs()>0.05 || (zs[1]-thickness).abs()>0.05 {
                fail(&format!("{name}: incorrect material ray intersections at ({x},{y}): {zs:?}"));
            }
        } else if !zs.is_empty() {
            fail(&format!("{name}: expected empty bore/exterior but got intersections: {zs:?}"));
        }
        println!("RAY {name} {x:.9} {y:.9} {} {:.9} {:.9}",
            zs.len(),zs.first().copied().unwrap_or(-1.0),zs.last().copied().unwrap_or(-1.0));
    }
    println!("ACCEPT solids=1 source_unit={} imported_exact={} tris={} open_edges={} volume_mm3={:.9} expected_mm3={:.9} warnings={}",
        cad.length_unit,body.exact.is_some(),tris,unpaired,volume,wanted,cad.warnings.len());
    for warning in &cad.warnings { eprintln!("IMPORT_WARNING: {warning}"); }
}
