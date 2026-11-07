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

// Distinct, bounded KERNEL-002 L-profile STEP fixture. All observations below
// come from the separately implemented AnvilCAD imported mesh, not from
// the OCCT same-engine receipt or an AP214 text scan.
fn l_profile(args: &[String]) {
    if args.len()!=9 { fail("usage: --l-profile STEP WIDTH DEPTH THICKNESS LEG_WIDTH FOOT_HEIGHT POCKET_DEPTH"); }
    let (width,depth,thickness,leg,foot,pocket)=(
        number(&args[3]),number(&args[4]),number(&args[5]),
        number(&args[6]),number(&args[7]),number(&args[8]));
    // Explicit admission of the four source-matched authored scenarios only.
    // Positions of the window and blind pocket are immutable in this fixture.
    let near=|a:f64,b:f64| (a-b).abs()<1e-8;
    if !near(depth,80.0)||!near(leg,30.0)||!near(foot,20.0) ||
       !((near(width,120.0)&&near(thickness,8.0)&&near(pocket,3.0))||
         (near(width,120.0)&&near(thickness,12.0)&&near(pocket,3.0))||
         (near(width,140.0)&&near(thickness,8.0)&&near(pocket,3.0))||
         (near(width,120.0)&&near(thickness,8.0)&&near(pocket,5.0))) {
        fail("unsupported authored L-profile/through-window/blind-pocket fixture");
    }
    let source=fs::read_to_string(&args[2]).unwrap_or_else(|_|fail("cannot read original L-profile STEP"));
    let cad=import(&source).unwrap_or_else(|e|fail(&format!("independent L-profile import failed: {e}")));
    if cad.length_unit!="millimetre" && cad.length_unit!="millimeter" {
        fail("independent L-profile units are not millimetres");
    }
    if cad.bodies.len()!=1 || !cad.bodies[0].solid {
        fail("L-profile did not import as precisely one solid");
    }
    let body=&cad.bodies[0];
    if body.exact.is_none() || !cad.warnings.is_empty() {
        fail("L-profile lacks exact B-rep or emitted import warnings");
    }
    let mesh=&body.mesh;
    if mesh.vertices.is_empty() || mesh.faces.is_empty() {fail("empty independent L-profile mesh");}
    let mut oriented:HashMap<(u32,u32),usize>=HashMap::new();
    let mut signed_volume=0.0f64;
    let mut tris=0usize;
    for tri in mesh.faces.iter().flat_map(|f| &f.triangles) {
        let a=point(mesh,tri[0]); let b=point(mesh,tri[1]); let c=point(mesh,tri[2]); tris+=1;
        let cross=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]];
        signed_volume+=(a[0]*cross[0]+a[1]*cross[1]+a[2]*cross[2])/6.0;
        for k in 0..3 { *oriented.entry((tri[k],tri[(k+1)%3])).or_default()+=1; }
    }
    let unpaired=oriented.iter().filter(|((a,b),n)| **n!=1||oriented.get(&(*b,*a))!=Some(&1)).count();
    if tris<8 || unpaired!=0 || !signed_volume.is_finite() {
        fail("L-profile imported mesh is open, degenerate or invalid");
    }
    // Six-edge L sketch: 30-mm leg, 20-mm foot, 10x8 through window
    // centred (15,-30) and 8x10 top-down pocket centred (-45,10).
    let wanted=(width*foot+leg*(depth-foot)-80.0)*thickness-80.0*pocket;
    let volume=signed_volume.abs();
    if !wanted.is_finite()||wanted<=0.0||(volume-wanted).abs()>wanted*0.01 {
        fail(&format!("independent L-profile mesh volume mismatch: {volume} vs {wanted}"));
    }
    // Each expected terminal Z is determined from independently authored
    // stock/cut dimensions: None denotes exterior or through-window void.
    // The blind-pocket rays must terminate at its *floor*, not at the top face.
    let mut rays:Vec<(&str,f64,f64,Option<f64>)>=vec![
        ("foot.solid",0.0,-30.0,Some(thickness)),
        ("leg.solid",-width/2.0+10.0,0.0,Some(thickness)),
        ("notch.void",0.0,0.0,None),
        ("exterior.void",width/2.0+4.0,-30.0,None),
        ("foot.tip.inner",width/2.0-1.0,-30.0,Some(thickness)),
        ("foot.tip.outer",width/2.0+1.0,-30.0,None),
        ("leg.notch.inner",-width/2.0+leg-1.0,0.0,Some(thickness)),
        ("leg.notch.outer",-width/2.0+leg+1.0,0.0,None),
        ("foot.front.inner",0.0,-depth/2.0+1.0,Some(thickness)),
        ("foot.front.outer",0.0,-depth/2.0-1.0,None),
        ("leg.top.inner",-width/2.0+10.0,depth/2.0-1.0,Some(thickness)),
        ("leg.top.outer",-width/2.0+10.0,depth/2.0+1.0,None),
        ("window.centre",15.0,-30.0,None),
        ("window.east.inner",19.0,-30.0,None),
        ("window.east.outer",21.0,-30.0,Some(thickness)),
        ("window.west.inner",11.0,-30.0,None),
        ("window.west.outer",9.0,-30.0,Some(thickness)),
        ("window.north.inner",15.0,-27.0,None),
        ("window.north.outer",15.0,-25.0,Some(thickness)),
        ("window.south.inner",15.0,-33.0,None),
        ("window.south.outer",15.0,-35.0,Some(thickness)),
        ("pocket.centre",-45.0,10.0,Some(thickness-pocket)),
        ("pocket.east.inner",-41.5,10.0,Some(thickness-pocket)),
        ("pocket.east.outer",-40.5,10.0,Some(thickness)),
        ("pocket.west.inner",-48.5,10.0,Some(thickness-pocket)),
        ("pocket.west.outer",-49.5,10.0,Some(thickness)),
        ("pocket.north.inner",-45.0,14.5,Some(thickness-pocket)),
        ("pocket.north.outer",-45.0,15.5,Some(thickness)),
        ("pocket.south.inner",-45.0,5.5,Some(thickness-pocket)),
        ("pocket.south.outer",-45.0,4.5,Some(thickness)),
    ];
    for (name,x,y,end) in rays.drain(..) {
        let zs=intersections(mesh,x,y);
        match end {
            Some(top) => {
                if zs.len()!=2 || zs[0].abs()>0.05 || (zs[1]-top).abs()>0.05 {
                    fail(&format!("{name}: wrong independent material/pocket-floor ray at ({x},{y}): {zs:?}"));
                }
            }
            None => if !zs.is_empty() {
                fail(&format!("{name}: unexpected material in absent L-profile/window at ({x},{y}): {zs:?}"));
            },
        }
        println!("L_RAY {name} {x:.9} {y:.9} {} {:.9} {:.9}",
            zs.len(),zs.first().copied().unwrap_or(-1.0),zs.last().copied().unwrap_or(-1.0));
    }
    println!("L_ACCEPT solids=1 source_unit={} imported_exact=true tris={} open_edges=0 volume_mm3={volume:.9} expected_mm3={wanted:.9} warnings=0",
        cad.length_unit,tris);
}

fn main() {
    let args:Vec<String>=env::args().collect();
    if args.get(1).map(String::as_str)==Some("--l-profile") { l_profile(&args); return; }
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
    // The original centre/volume probes cannot identify a wrong individual
    // bore radius when another radius compensates to preserve removed area.
    // Require empty just inside and full material just outside EACH wall.
    // Four orientations also expose asymmetric or displaced hole contours.
    for (i, &(hx, hy, radius)) in holes.iter().enumerate() {
        let delta = (radius * 0.15).min(0.75);
        for (direction, dx, dy) in [
            ("east", 1.0, 0.0), ("west", -1.0, 0.0),
            ("north", 0.0, -1.0), ("south", 0.0, 1.0),
        ] {
            let near = radius - delta;
            let far = radius + delta;
            probes.push((format!("hole.{i}.inner.{direction}"),
                         hx + dx * near, hy + dy * near, false));
            probes.push((format!("hole.{i}.outer.{direction}"),
                         hx + dx * far, hy + dy * far, true));
        }
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
