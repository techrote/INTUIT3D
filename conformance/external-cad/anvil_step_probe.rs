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


// Independent, restricted OCCT8 KERNEL-002 ordered-rectangle and mixed-circle
// cut chain admission. Read the actual imported *non-OCCT* mesh; do not accept
// native source-side volume, STEP entity strings, or synthetic probe receipts.
fn cut_chains(args: &[String]) {
    if args.len()!=5 { fail("usage: --cut-chains STEP ordered|mixed 8|12"); }
    let kind=&args[3];
    if kind!="ordered" && kind!="mixed" { fail("unsupported physical cut-chain kind"); }
    let thickness=number(&args[4]);
    if thickness!=8.0 && thickness!=12.0 { fail("unsupported physical cut-chain thickness"); }
    let pocket_depth=if thickness==8.0 {3.0} else {5.0};
    let area=if kind=="ordered" { 120.0 } else { std::f64::consts::PI*25.0 };
    let volume_expected=(120.0*80.0-2.0*std::f64::consts::PI*36.0)*thickness
        -80.0*thickness-area*pocket_depth;
    let source=fs::read_to_string(&args[2]).unwrap_or_else(|_|fail("cannot read pinned cut-chain STEP"));
    let cad=import(&source).unwrap_or_else(|e|fail(&format!("independent cut-chain STEP import failed: {e}")));
    if cad.length_unit!="millimetre" && cad.length_unit!="millimeter" {
        fail("cut-chain STEP units are not mm");
    }
    if cad.bodies.len()!=1 || !cad.bodies[0].solid || cad.bodies[0].exact.is_none() ||
       !cad.warnings.is_empty() {
        fail("cut-chain import lacks one exact warning-free B-rep solid");
    }
    let mesh=&cad.bodies[0].mesh;
    if mesh.vertices.is_empty() || mesh.faces.is_empty() { fail("empty cut-chain mesh"); }
    let mut oriented:HashMap<(u32,u32),usize>=HashMap::new();
    let mut signed_volume=0.0f64;
    let mut tris=0usize;
    for tri in mesh.faces.iter().flat_map(|f| &f.triangles) {
        let a=point(mesh,tri[0]); let b=point(mesh,tri[1]); let c=point(mesh,tri[2]); tris+=1;
        let cross=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]];
        signed_volume+=(a[0]*cross[0]+a[1]*cross[1]+a[2]*cross[2])/6.0;
        for k in 0..3 { *oriented.entry((tri[k],tri[(k+1)%3])).or_default()+=1; }
    }
    let open=oriented.iter().filter(|((a,b),n)| **n!=1 ||
        oriented.get(&(*b,*a))!=Some(&1)).count();
    let measured=signed_volume.abs();
    if tris<8 || open!=0 || !measured.is_finite() ||
       (measured-volume_expected).abs()>volume_expected*0.01 {
        fail(&format!("wrong independent cut-chain watertightness/volume: {measured} vs {volume_expected}, open={open}"));
    }
    // Each ray contains the source-model coordinate, not an importer-provided
    // descriptive label. None=exterior/through void; Some=solid terminal Z.
    let mut rays:Vec<(String,f64,f64,Option<f64>)>=Vec::new();
    for (name,x,y) in [
        ("stock.centre",0.0,0.0),("stock.nw",-45.0,-30.0),
        ("stock.ne",45.0,30.0),
    ] { rays.push((name.to_string(),x,y,Some(thickness))); }
    for (i,x) in [-30.0f64,30.0].iter().enumerate() {
        rays.push((format!("bore.{i}.centre"),*x,0.0,None));
        for (direction,dx,dy) in [
            ("east",1.0,0.0),("west",-1.0,0.0),
            ("north",0.0,-1.0),("south",0.0,1.0),
        ] {
            rays.push((format!("bore.{i}.inner.{direction}"),*x+5.4*dx,5.4*dy,None));
            rays.push((format!("bore.{i}.outer.{direction}"),*x+6.6*dx,6.6*dy,Some(thickness)));
        }
    }
    // Authoritative cut coordinates are defined by the independent fixture,
    // not copied from the OCCT runtime receipt. Through window centre (5,-20),
    // width 10, height 8, and 8.0/12.0-mm through-depth.
    rays.push(("window.centre".to_string(),5.0,-20.0,None));
    for (direction,dx,dy,half) in [
        ("east",1.0,0.0,5.0),("west",-1.0,0.0,5.0),
        ("north",0.0,1.0,4.0),("south",0.0,-1.0,4.0),
    ] {
        rays.push((format!("window.inner.{direction}"),5.0+(half-0.5)*dx,
                   -20.0+(half-0.5)*dy,None));
        rays.push((format!("window.outer.{direction}"),5.0+(half+0.5)*dx,
                   -20.0+(half+0.5)*dy,Some(thickness)));
    }
    let floor=Some(thickness-pocket_depth);
    rays.push(("pocket.centre".to_string(),-10.0,20.0,floor));
    for (direction,dx,dy,half) in [
        ("east",1.0,0.0,if kind=="ordered" {6.0} else {5.0}),
        ("west",-1.0,0.0,if kind=="ordered" {6.0} else {5.0}),
        ("north",0.0,1.0,5.0),("south",0.0,-1.0,5.0),
    ] {
        rays.push((format!("pocket.inner.{direction}"),
                   -10.0+(half-0.5)*dx,20.0+(half-0.5)*dy,floor));
        rays.push((format!("pocket.outer.{direction}"),
                   -10.0+(half+0.5)*dx,20.0+(half+0.5)*dy,Some(thickness)));
    }
    for (name,x,y,end) in rays {
        let hits=intersections(mesh,x,y);
        match end {
            Some(top) => {
                if hits.len()!=2 || hits[0].abs()>0.05 || (hits[1]-top).abs()>0.05 {
                    fail(&format!("{name}: wrong material or blind-pocket floor at ({x},{y}): {hits:?}"));
                }
            }
            None => if !hits.is_empty() {
                fail(&format!("{name}: expected independent through void at ({x},{y}): {hits:?}"));
            },
        }
        println!("CUT_RAY {name} {x:.9} {y:.9} {} {:.9} {:.9}",
                 hits.len(),hits.first().copied().unwrap_or(-1.0),
                 hits.last().copied().unwrap_or(-1.0));
    }
    println!("CUT_ACCEPT kind={} solids=1 source_unit={} imported_exact=true tris={} open_edges=0 volume_mm3={measured:.9} expected_mm3={volume_expected:.9} warnings=0",
             kind,cad.length_unit,tris);
}


// Analytic material distribution of the authored U-bracket, not native OCCT
// mass-property metadata. Six central second volume moments (covariance mm²).
fn u_bracket_covariance_expected(thickness: f64, centre: [f64;3], volume: f64) -> [f64;6] {
    let t=thickness;
    // sign, occupied/removed volume, local centre, intrinsic variances.
    // A uniform circular cylinder has lateral variance r²/4 per axis.
    let components=[
        (1.0,120.0*80.0*t,[0.0,0.0,t/2.0],
            [120.0f64.powi(2)/12.0,80.0f64.powi(2)/12.0,t*t/12.0]),
        (-1.0,70.0*50.0*t,[0.0,15.0,t/2.0],
            [70.0f64.powi(2)/12.0,50.0f64.powi(2)/12.0,t*t/12.0]),
        (-1.0,10.0*12.0*t,[47.0,10.0,t/2.0],
            [10.0f64.powi(2)/12.0,12.0f64.powi(2)/12.0,t*t/12.0]),
        (-1.0,std::f64::consts::PI*25.0*3.0,[-47.0,10.0,t-1.5],
            [25.0/4.0,25.0/4.0,9.0/12.0]),
    ];
    let axes=[(0,0),(1,1),(2,2),(0,1),(0,2),(1,2)];
    let mut second=[0.0f64;6];
    for (sign,part_volume,covcentre,variance) in components {
        for (k,(i,j)) in axes.iter().enumerate() {
            second[k]+=sign*part_volume*(covcentre[*i]*covcentre[*j]+
                        if i==j {variance[*i]} else {0.0});
        }
    }
    for (k,(i,j)) in axes.iter().enumerate() {
        second[k]=second[k]/volume-centre[*i]*centre[*j];
    }
    second
}


// Genuine selected eight-edge U-bracket with one circular BLIND and one
// rectangular THROUGH cut. All predicates run on separately imported
// non-OCCT CAD mesh vertices, never on the producer's STEP metadata.
fn u_bracket(args: &[String]) {
    if args.len()!=4 { fail("usage: --u-bracket STEP 8|12"); }
    let thickness=number(&args[3]);
    if thickness!=8.0 && thickness!=12.0 {
        fail("unsupported native U-bracket thickness");
    }
    let source=fs::read_to_string(&args[2])
        .unwrap_or_else(|_|fail("cannot read original U-bracket STEP"));
    let cad=import(&source)
        .unwrap_or_else(|e| fail(&format!("independent U-bracket import failed: {e}")));
    if cad.length_unit!="millimetre" && cad.length_unit!="millimeter" {
        fail("U-bracket units are not independently recognized as millimetres");
    }
    if cad.bodies.len()!=1 || !cad.bodies[0].solid ||
       cad.bodies[0].exact.is_none() || !cad.warnings.is_empty() {
        fail("U-bracket import lacks one exact warning-free B-rep solid");
    }
    let mesh=&cad.bodies[0].mesh;
    if mesh.vertices.is_empty() || mesh.faces.is_empty() {
        fail("empty imported U-bracket mesh");
    }
    let mut oriented:HashMap<(u32,u32),usize>=HashMap::new();
    let mut signed_volume=0.0f64;
    // Tetrahedra between imported mesh and origin give volume and first
    // moments without trusting the native producer's mass-properties receipt.
    let mut first_moment=[0.0f64;3];
    let mut second_moment=[0.0f64;6];
    let moment_axes=[(0,0),(1,1),(2,2),(0,1),(0,2),(1,2)];
    let mut tris=0usize;
    for tri in mesh.faces.iter().flat_map(|face| &face.triangles) {
        let a=point(mesh,tri[0]); let b=point(mesh,tri[1]); let c=point(mesh,tri[2]);
        tris+=1;
        let cross=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]];
        let tetra=(a[0]*cross[0]+a[1]*cross[1]+a[2]*cross[2])/6.0;
        signed_volume+=tetra;
        for axis in 0..3 {
            first_moment[axis]+=tetra*(a[axis]+b[axis]+c[axis])/4.0;
        }
        // Exact signed tetrahedral integration of the mesh second moments.
        for (k,(i,j)) in moment_axes.iter().enumerate() {
            let si=a[*i]+b[*i]+c[*i];
            let sj=a[*j]+b[*j]+c[*j];
            let diagonal=a[*i]*a[*j]+b[*i]*b[*j]+c[*i]*c[*j];
            second_moment[k]+=tetra*(si*sj+diagonal)/20.0;
        }
        for i in 0..3 { *oriented.entry((tri[i],tri[(i+1)%3])).or_default()+=1; }
    }
    let open=oriented.iter().filter(|((a,b),count)|
        **count!=1 || oriented.get(&(*b,*a))!=Some(&1)).count();
    let expected=(120.0*80.0-70.0*50.0-10.0*12.0)*thickness
        -std::f64::consts::PI*25.0*3.0;
    let measured=signed_volume.abs();
    if tris<8 || open!=0 || !measured.is_finite() || measured<1.0 ||
        (measured-expected).abs()>expected*0.01 {
        fail(&format!("wrong independent U-bracket topology/volume: {measured} vs {expected}, open={open}"));
    }
    // Analytic first moments of source fixture: 120x80 stock less 70x50
    // notch centred at Y=15; through 10x12 at (47,10); R5 blind pocket
    // at (-47,10) for the top 3mm. Equal volume cannot mask displaced cuts.
    let through_volume=120.0*thickness;
    let blind_volume=std::f64::consts::PI*25.0*3.0;
    let stock_volume=(120.0*80.0-70.0*50.0)*thickness;
    let expected_centroid=[
        (-47.0*through_volume+47.0*blind_volume)/expected,
        (-70.0*50.0*15.0*thickness-10.0*through_volume-10.0*blind_volume)/expected,
        ((stock_volume-through_volume)*thickness/2.0
           -blind_volume*(thickness-1.5))/expected,
    ];
    let measured_centroid=[
        first_moment[0]/signed_volume,
        first_moment[1]/signed_volume,
        first_moment[2]/signed_volume,
    ];
    for axis in 0..3 {
        if !measured_centroid[axis].is_finite() ||
           (measured_centroid[axis]-expected_centroid[axis]).abs()>0.15 {
            fail(&format!("independent U-bracket material centroid axis {axis} wrong: {:.6} vs {:.6} mm",
                          measured_centroid[axis],expected_centroid[axis]));
        }
    }
    let expected_covariance=u_bracket_covariance_expected(thickness,expected_centroid,expected);
    let mut measured_covariance=[0.0f64;6];
    for (k,(i,j)) in moment_axes.iter().enumerate() {
        measured_covariance[k]=second_moment[k]/signed_volume-
            measured_centroid[*i]*measured_centroid[*j];
        let reference=expected_covariance[k];
        let tolerance=if k<3 { (reference.abs()*0.01).max(0.1) }
                      else { (reference.abs()*0.05).max(0.25) };
        if !measured_covariance[k].is_finite() ||
           (measured_covariance[k]-reference).abs()>tolerance {
            fail(&format!("independent U-bracket material covariance {k} wrong: {:.6} vs {:.6} mm²",
                          measured_covariance[k],reference));
        }
    }
    // Fixed world XY anchors from the source fixture's independently specified
    // polygon vertices and cut dimensions. 'None' means no material along Z.
    let mut rays:Vec<(String,f64,f64,Option<f64>)>=vec![
        ("stock.left.foot".into(),-47.0,-30.0,Some(thickness)),
        ("stock.right.foot".into(),47.0,-30.0,Some(thickness)),
        ("stock.web".into(),0.0,-30.0,Some(thickness)),
        ("stock.left.top".into(),-47.0,30.0,Some(thickness)),
        ("stock.right.top".into(),47.0,30.0,Some(thickness)),
        ("notch.void".into(),0.0,10.0,None),
        ("notch.floor.inner".into(),0.0,-9.0,None),
        ("notch.floor.outer".into(),0.0,-11.0,Some(thickness)),
        ("notch.left.inner".into(),-34.0,10.0,None),
        ("notch.left.outer".into(),-36.0,10.0,Some(thickness)),
        ("notch.right.inner".into(),34.0,10.0,None),
        ("notch.right.outer".into(),36.0,10.0,Some(thickness)),
        ("exterior.left.inner".into(),-59.0,0.0,Some(thickness)),
        ("exterior.left.outer".into(),-61.0,0.0,None),
        ("exterior.right.inner".into(),59.0,0.0,Some(thickness)),
        ("exterior.right.outer".into(),61.0,0.0,None),
        ("exterior.bottom.inner".into(),0.0,-39.0,Some(thickness)),
        ("exterior.bottom.outer".into(),0.0,-41.0,None),
        ("exterior.top.left.inner".into(),-47.0,39.0,Some(thickness)),
        ("exterior.top.left.outer".into(),-47.0,41.0,None),
        ("exterior.top.right.inner".into(),47.0,39.0,Some(thickness)),
        ("exterior.top.right.outer".into(),47.0,41.0,None),
    ];
    // Right-leg 10x12 through rectangle centred (47,10): empty on the
    // inside, full-height material just outside each of its four walls.
    rays.push(("rectangle.centre".into(),47.0,10.0,None));
    for (side,dx,dy,half) in [
        ("east",1.0,0.0,5.0),("west",-1.0,0.0,5.0),
        ("north",0.0,1.0,6.0),("south",0.0,-1.0,6.0)
    ] {
        rays.push((format!("rectangle.inner.{side}"),47.0+(half-0.5)*dx,
                   10.0+(half-0.5)*dy,None));
        rays.push((format!("rectangle.outer.{side}"),47.0+(half+0.5)*dx,
                   10.0+(half+0.5)*dy,Some(thickness)));
    }
    // Left-leg R5 blind circular pocket centred (-47,10), with a physical
    // floor at thickness-3, NOT a zero-material through hole.
    let floor=Some(thickness-3.0);
    rays.push(("circle.centre".into(),-47.0,10.0,floor));
    for (side,dx,dy) in [
        ("east",1.0,0.0),("west",-1.0,0.0),
        ("north",0.0,1.0),("south",0.0,-1.0)
    ] {
        rays.push((format!("circle.inner.{side}"),-47.0+4.5*dx,
                   10.0+4.5*dy,floor));
        rays.push((format!("circle.outer.{side}"),-47.0+5.5*dx,
                   10.0+5.5*dy,Some(thickness)));
    }
    if rays.len()!=40 { fail("U-bracket physical sampling incomplete"); }
    for (name,x,y,top) in rays {
        let zs=intersections(mesh,x,y);
        match top {
            Some(expected_z) => {
                if zs.len()!=2 || zs[0].abs()>0.05 || (zs[1]-expected_z).abs()>0.05 {
                    fail(&format!("{name}: wrong imported U-bracket material/floor at ({x},{y}): {zs:?}"));
                }
            }
            None => if !zs.is_empty() {
                fail(&format!("{name}: unexpected imported material in U-bracket void at ({x},{y}): {zs:?}"));
            },
        }
        println!("U_RAY {name} {x:.9} {y:.9} {} {:.9} {:.9}",
                 zs.len(),zs.first().copied().unwrap_or(-1.0),
                 zs.last().copied().unwrap_or(-1.0));
    }
    println!("U_ACCEPT solids=1 source_unit={} imported_exact=true tris={} open_edges=0 volume_mm3={measured:.9} expected_mm3={expected:.9} centroid_x_mm={:.9} centroid_y_mm={:.9} centroid_z_mm={:.9} cov_xx_mm2={:.9} cov_yy_mm2={:.9} cov_zz_mm2={:.9} cov_xy_mm2={:.9} cov_xz_mm2={:.9} cov_yz_mm2={:.9} warnings=0",
             cad.length_unit,tris,measured_centroid[0],measured_centroid[1],measured_centroid[2],
             measured_covariance[0],measured_covariance[1],measured_covariance[2],
             measured_covariance[3],measured_covariance[4],measured_covariance[5]);
}

fn main() {
    let args:Vec<String>=env::args().collect();
    if args.get(1).map(String::as_str)==Some("--u-bracket") { u_bracket(&args); return; }
    if args.get(1).map(String::as_str)==Some("--cut-chains") { cut_chains(&args); return; }
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
