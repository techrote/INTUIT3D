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
fn u_bracket_surface_expected(thickness: f64) -> f64 {
    // Exposed U stock: top/bottom footprint (6100 mm2), less 10x12
    // through cut on each face. The U's eight-edge outer + inner
    // perimeter is 500 mm, the window adds 44 mm of wall perimeter.
    // The blind R5, depth-3 pocket exchanges its top disc for a floor
    // (zero net flat area), and adds a 2*pi*r*depth cylindrical wall.
    2.0*(120.0*80.0-70.0*50.0-10.0*12.0)
        +(500.0+2.0*(10.0+12.0))*thickness
        +2.0*std::f64::consts::PI*5.0*3.0
}

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
    let mut surface_area=0.0f64;
    let moment_axes=[(0,0),(1,1),(2,2),(0,1),(0,2),(1,2)];
    let mut tris=0usize;
    for tri in mesh.faces.iter().flat_map(|face| &face.triangles) {
        let a=point(mesh,tri[0]); let b=point(mesh,tri[1]); let c=point(mesh,tri[2]);
        tris+=1;
        let cross=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]];
        let tetra=(a[0]*cross[0]+a[1]*cross[1]+a[2]*cross[2])/6.0;
        signed_volume+=tetra;
        // Direct oriented-mesh surface measure, independent of the
        // OCCT source's area report and unaffected by triangle winding.
        // Use edge differences (not the origin-relative volume cross).
        let u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
        let v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
        let area_cross=[
            u[1]*v[2]-u[2]*v[1],
            u[2]*v[0]-u[0]*v[2],
            u[0]*v[1]-u[1]*v[0],
        ];
        surface_area+=0.5*(area_cross[0]*area_cross[0]
            +area_cross[1]*area_cross[1]
            +area_cross[2]*area_cross[2]).sqrt();
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
    let expected_surface=u_bracket_surface_expected(thickness);
    if !surface_area.is_finite() || surface_area<=0.0 ||
       (surface_area-expected_surface).abs()>expected_surface*0.01 {
        fail(&format!("independent U-bracket physical surface area wrong: {:.6} vs {:.6} mm²",
                      surface_area,expected_surface));
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
    println!("U_ACCEPT solids=1 source_unit={} imported_exact=true tris={} open_edges=0 volume_mm3={measured:.9} expected_mm3={expected:.9} centroid_x_mm={:.9} centroid_y_mm={:.9} centroid_z_mm={:.9} cov_xx_mm2={:.9} cov_yy_mm2={:.9} cov_zz_mm2={:.9} cov_xy_mm2={:.9} cov_xz_mm2={:.9} cov_yz_mm2={:.9} surface_area_mm2={:.9} expected_surface_mm2={:.9} warnings=0",
             cad.length_unit,tris,measured_centroid[0],measured_centroid[1],measured_centroid[2],
             measured_covariance[0],measured_covariance[1],measured_covariance[2],
             measured_covariance[3],measured_covariance[4],measured_covariance[5],
             surface_area,expected_surface);
}


// KERNEL-002 v5: independently import real selected *sloped* contours and
// reconstruct two differently edited C++ STEP exports. The oracle is the
// immutable selected six-edge polygon and actual cuts, not native STEP text,
// native mass-property receipts, or another OCCT reader. "direct" contains a
// circular blind pocket; "authored" contains a rectangular blind pocket.
// Independent analytic 3D mass distribution of the selected sloped polygon
// minus explicitly located cutter volumes. Never uses producer STEP metadata.
fn sloped_mass_expected(kind: &str, cut_count: usize, t: f64)
    -> ([f64;3],[f64;6]) {
    let vertices=[(0.0f64,0.0f64),(120.0,0.0),(120.0,20.0),
                  (65.0,20.0),(45.0,80.0),(0.0,80.0)];
    let mut twice_area=0.0;
    let mut first_x=0.0; let mut first_y=0.0;
    let mut second_xx=0.0; let mut second_yy=0.0; let mut second_xy=0.0;
    for i in 0..vertices.len() {
        let (x,y)=vertices[i]; let (nx,ny)=vertices[(i+1)%vertices.len()];
        let cross=x*ny-nx*y;
        twice_area+=cross;
        first_x+=(x+nx)*cross/6.0;
        first_y+=(y+ny)*cross/6.0;
        second_xx+=(x*x+x*nx+nx*nx)*cross/12.0;
        second_yy+=(y*y+y*ny+ny*ny)*cross/12.0;
        second_xy+=(2.0*x*y+x*ny+nx*y+2.0*nx*ny)*cross/24.0;
    }
    let area=twice_area/2.0;
    if (area-5700.0f64).abs()>1e-8 { fail("invalid independent sloped polygon oracle"); }
    let mut mass=area*t;
    let mut first=[first_x*t,first_y*t,area*t*t/2.0];
    let mut second=[second_xx*t,second_yy*t,area*t*t*t/3.0,
                    second_xy*t,first_x*t*t/2.0,first_y*t*t/2.0];
    let axes=[(0,0),(1,1),(2,2),(0,1),(0,2),(1,2)];
    let has_window=if kind=="direct" {cut_count==2} else {cut_count>=1};
    let has_pocket=if kind=="direct" {cut_count>=1} else {cut_count==2};
    let mut subtract=|removed:f64,c:[f64;3],variance:[f64;3]| {
        mass-=removed;
        for i in 0..3 {first[i]-=removed*c[i];}
        for (k,(i,j)) in axes.iter().enumerate() {
            second[k]-=removed*(c[*i]*c[*j]+
                       if i==j {variance[*i]} else {0.0});
        }
    };
    if has_window {
        subtract(112.0*t,[95.0,10.0,t/2.0],
                 [14.0f64.powi(2)/12.0,8.0f64.powi(2)/12.0,t*t/12.0]);
    }
    if has_pocket {
        let area=if kind=="direct" {std::f64::consts::PI*25.0} else {100.0};
        let lateral=if kind=="direct" {25.0/4.0} else {100.0/12.0};
        subtract(area*3.0,[15.0,50.0,t-1.5],[lateral,lateral,9.0/12.0]);
    }
    let centre=[first[0]/mass,first[1]/mass,first[2]/mass];
    let mut covariance=[0.0;6];
    for (k,(i,j)) in axes.iter().enumerate() {
        covariance[k]=second[k]/mass-centre[*i]*centre[*j];
    }
    (centre,covariance)
}

fn sloped_profile(args: &[String]) {
    let progressive=args.get(1).map(String::as_str)==Some("--progressive-v6");
    if (progressive && args.len()!=6) || (!progressive && args.len()!=5) {
        fail("usage: --sloped-profile STEP direct|authored 8|12 OR --progressive-v6 STEP direct|authored 0|1|2 8|12");
    }
    let kind=args[3].as_str();
    if kind!="direct" && kind!="authored" { fail("unsupported sloped profile fixture"); }
    let cut_count=if progressive {
        args[4].parse::<usize>().unwrap_or_else(|_|fail("invalid progressive cut count"))
    } else { 2 };
    if cut_count>2 { fail("unsupported progressive cut count"); }
    let t=number(&args[if progressive {5} else {4}]);
    if t!=8.0 && t!=12.0 { fail("unsupported sloped profile thickness"); }
    // Direct progresses stock -> blind R5 -> blind+through.
    // Authored progresses stock -> through -> through+square blind.
    let has_window=if kind=="direct" {cut_count==2} else {cut_count>=1};
    let has_pocket=if kind=="direct" {cut_count>=1} else {cut_count==2};
    let pocket_area=if kind=="direct" { std::f64::consts::PI*25.0 } else {100.0};
    let pocket_wall=if kind=="direct" { 2.0*std::f64::consts::PI*5.0*3.0 } else {40.0*3.0};
    let removed_window=if has_window {112.0} else {0.0};
    let added_wall=if has_window {44.0} else {0.0};
    let wanted=(5700.0-removed_window)*t
        -(if has_pocket {pocket_area*3.0} else {0.0});
    let wanted_surface=2.0*(5700.0-removed_window)
        +(320.0+4000.0f64.sqrt()+added_wall)*t
        +(if has_pocket {pocket_wall} else {0.0});
    let source=fs::read_to_string(&args[2])
        .unwrap_or_else(|_| fail("cannot read actual sloped-profile STEP bytes"));
    let cad=import(&source)
        .unwrap_or_else(|e|fail(&format!("independent sloped STEP import failed: {e}")));
    if cad.length_unit!="millimetre" && cad.length_unit!="millimeter" {
        fail("sloped-profile imported length unit is not millimetres");
    }
    if cad.bodies.len()!=1 || !cad.bodies[0].solid ||
       cad.bodies[0].exact.is_none() || !cad.warnings.is_empty() {
        fail("sloped-profile import must produce one warning-free exact B-rep solid");
    }
    let mesh=&cad.bodies[0].mesh;
    if mesh.vertices.is_empty() || mesh.faces.is_empty() {
        fail("empty independently reconstructed sloped mesh");
    }
    let mut directed:HashMap<(u32,u32),usize>=HashMap::new();
    let mut signed_volume=0.0f64;
    let mut first_moment=[0.0f64;3];
    let mut second_moment=[0.0f64;6];
    let axes=[(0,0),(1,1),(2,2),(0,1),(0,2),(1,2)];
    let mut surface=0.0f64;
    let mut tris=0usize;
    for triangle in mesh.faces.iter().flat_map(|face| &face.triangles) {
        let a=point(mesh,triangle[0]);
        let b=point(mesh,triangle[1]);
        let c=point(mesh,triangle[2]);
        tris+=1;
        let u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
        let v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
        let cross=[u[1]*v[2]-u[2]*v[1],
                   u[2]*v[0]-u[0]*v[2],
                   u[0]*v[1]-u[1]*v[0]];
        surface+=0.5*(cross.iter().map(|x|x*x).sum::<f64>()).sqrt();
        let origin_cross=[b[1]*c[2]-b[2]*c[1],
                          b[2]*c[0]-b[0]*c[2],
                          b[0]*c[1]-b[1]*c[0]];
        let tetra=(a[0]*origin_cross[0]+a[1]*origin_cross[1]
                   +a[2]*origin_cross[2])/6.0;
        signed_volume+=tetra;
        for axis in 0..3 {
            first_moment[axis]+=tetra*(a[axis]+b[axis]+c[axis])/4.0;
        }
        for (k,(i,j)) in axes.iter().enumerate() {
            let si=a[*i]+b[*i]+c[*i];
            let sj=a[*j]+b[*j]+c[*j];
            let diagonal=a[*i]*a[*j]+b[*i]*b[*j]+c[*i]*c[*j];
            second_moment[k]+=tetra*(si*sj+diagonal)/20.0;
        }
        for i in 0..3 {
            *directed.entry((triangle[i],triangle[(i+1)%3])).or_default()+=1;
        }
    }
    let open=directed.iter().filter(|((a,b),n)|
        **n!=1 || directed.get(&(*b,*a))!=Some(&1)).count();
    let volume=signed_volume.abs();
    if tris<8 || open!=0 || !volume.is_finite() || !surface.is_finite() ||
       (volume-wanted).abs()>wanted*0.01 ||
       (surface-wanted_surface).abs()>wanted_surface*0.01 {
        fail(&format!("sloped profile wrong mesh/mass/area: triangles={tris} open={open} volume={volume} expected={wanted} surface={surface} expected_surface={wanted_surface}"));
    }

    // Centroid and full material covariance detect volume/area-preserving
    // material displacement that sparse point rays can miss.
    let (expected_centre,expected_covariance)=sloped_mass_expected(kind,cut_count,t);
    let centre=[
        first_moment[0]/signed_volume,first_moment[1]/signed_volume,
        first_moment[2]/signed_volume,
    ];
    for i in 0..3 {
        if !centre[i].is_finite() || (centre[i]-expected_centre[i]).abs()>0.15 {
            fail(&format!("sloped imported material centroid axis {i} wrong: {:.6} vs {:.6} mm",
                          centre[i],expected_centre[i]));
        }
    }
    let mut covariance=[0.0;6];
    for (k,(i,j)) in axes.iter().enumerate() {
        covariance[k]=second_moment[k]/signed_volume-centre[*i]*centre[*j];
        let reference=expected_covariance[k];
        let tolerance=if k<3 { (reference.abs()*0.01).max(0.1) }
                      else { (reference.abs()*0.05).max(0.25) };
        if !covariance[k].is_finite() || (covariance[k]-reference).abs()>tolerance {
            fail(&format!("sloped imported material covariance {k} wrong: {:.6} vs {:.6} mm²",
                          covariance[k],reference));
        }
    }
    // Every point is in the independently authored world coordinate system.
    // The diagonal from (65,20) to (45,80) is x=65-(y-20)/3.
    // Test both sides of three different portions of the actual sloped edge,
    // along with concave re-entrant corner, stock, exterior and both cut walls.
    let mut rays:Vec<(String,f64,f64,Option<f64>)>=vec![
        ("stock.bottom".into(),40.0,5.0,Some(t)),
        ("stock.left".into(),5.0,40.0,Some(t)),
        ("stock.top".into(),5.0,75.0,Some(t)),
        ("stock.right_foot".into(),112.0,10.0,Some(t)),
        ("exterior.left".into(),-2.0,40.0,None),
        ("exterior.bottom".into(),40.0,-2.0,None),
        ("exterior.right".into(),122.0,10.0,None),
        ("exterior.top".into(),20.0,82.0,None),
        ("notch.below".into(),70.0,19.0,Some(t)),
        ("notch.above".into(),70.0,21.0,None),
    ];
    for (i,y) in [30.0f64,50.0,70.0].iter().enumerate() {
        let edge_x=65.0-(*y-20.0)/3.0;
        rays.push((format!("slope.{i}.inner"),edge_x-1.0,*y,Some(t)));
        rays.push((format!("slope.{i}.outer"),edge_x+1.0,*y,None));
    }
    rays.push(("window.centre".into(),95.0,10.0,if has_window {None} else {Some(t)}));
    for (side,dx,dy,half) in [
        ("east",1.0,0.0,7.0),("west",-1.0,0.0,7.0),
        ("north",0.0,1.0,4.0),("south",0.0,-1.0,4.0),
    ] {
        rays.push((format!("window.inner.{side}"),
                   95.0+(half-0.5)*dx,10.0+(half-0.5)*dy,
                   if has_window {None} else {Some(t)}));
        rays.push((format!("window.outer.{side}"),
                   95.0+(half+0.5)*dx,10.0+(half+0.5)*dy,Some(t)));
    }
    let floor=if has_pocket {Some(t-3.0)} else {Some(t)};
    rays.push(("pocket.centre".into(),15.0,50.0,floor));
    for (side,dx,dy) in [
        ("east",1.0,0.0),("west",-1.0,0.0),
        ("north",0.0,1.0),("south",0.0,-1.0),
    ] {
        rays.push((format!("pocket.inner.{side}"),15.0+4.5*dx,50.0+4.5*dy,floor));
        rays.push((format!("pocket.outer.{side}"),15.0+5.5*dx,50.0+5.5*dy,Some(t)));
    }
    // A circular R5 pocket and 10x10 square pocket have *identical*
    // occupancy at the four cardinal wall probes. At (+/-4,+/-4),
    // the point is outside the circle (r=5.657) but inside the square.
    // This is an indispensable physical shape-discrimination predicate:
    // volume and surface budgets alone cannot reliably reject a wrong cut.
    let diagonal_top=if kind=="direct" || !has_pocket { Some(t) } else { floor };
    for (side,dx,dy) in [
        ("ne",1.0,1.0),("nw",-1.0,1.0),
        ("se",1.0,-1.0),("sw",-1.0,-1.0),
    ] {
        rays.push((format!("pocket.diagonal.{side}"),
                   15.0+4.0*dx,50.0+4.0*dy,diagonal_top));
    }
    // Twelve independent angular directions bracket the circular or square
    // pocket wall at +/-0.2 mm in the imported B-rep triangulation. Unlike
    // the four diagonal/cardinal rays, these constrain actual wall radius,
    // selected centre and angular shape across every progressive cut stage.
    // For stages before the pocket exists, both samples must remain material.
    for i in 0..12 {
        let angle=(15.0_f64+30.0*i as f64).to_radians();
        let dx=angle.cos(); let dy=angle.sin();
        let wall=if kind=="direct" {5.0}
                 else {5.0/dx.abs().max(dy.abs())};
        let inner=wall-0.2; let outer=wall+0.2;
        rays.push((format!("pocket.radial.{i}.inner"),
                   15.0+inner*dx,50.0+inner*dy,
                   Some(if has_pocket {t-3.0} else {t})));
        rays.push((format!("pocket.radial.{i}.outer"),
                   15.0+outer*dx,50.0+outer*dy,Some(t)));
    }
    if rays.len()!=62 { fail("incomplete generalized sloped-profile ray oracle"); }
    for (name,x,y,expected) in rays {
        let zs=intersections(mesh,x,y);
        match expected {
            Some(top) => if zs.len()!=2 || zs[0].abs()>0.05 ||
                            (zs[1]-top).abs()>0.05 {
                fail(&format!("{name}: incorrect imported material/floor at ({x},{y}): {zs:?}"));
            },
            None => if !zs.is_empty() {
                fail(&format!("{name}: unexpected material in sloped void at ({x},{y}): {zs:?}"));
            },
        }
        println!("SLOPE_RAY {name} {x:.9} {y:.9} {} {:.9} {:.9}",
                 zs.len(),zs.first().copied().unwrap_or(-1.0),
                 zs.last().copied().unwrap_or(-1.0));
    }
    let moments=format!(
        "centroid_x_mm={:.9} centroid_y_mm={:.9} centroid_z_mm={:.9} cov_xx_mm2={:.9} cov_yy_mm2={:.9} cov_zz_mm2={:.9} cov_xy_mm2={:.9} cov_xz_mm2={:.9} cov_yz_mm2={:.9}",
        centre[0],centre[1],centre[2],covariance[0],covariance[1],
        covariance[2],covariance[3],covariance[4],covariance[5]);
    if progressive {
        println!("SLOPE_ACCEPT kind={kind} cuts={cut_count} thickness_mm={t:.1} solids=1 source_unit={} imported_exact=true tris={tris} open_edges=0 volume_mm3={volume:.9} expected_mm3={wanted:.9} surface_area_mm2={surface:.9} expected_surface_mm2={wanted_surface:.9} {moments} warnings=0",cad.length_unit);
    } else {
        println!("SLOPE_ACCEPT kind={kind} thickness_mm={t:.1} solids=1 source_unit={} imported_exact=true tris={tris} open_edges=0 volume_mm3={volume:.9} expected_mm3={wanted:.9} surface_area_mm2={surface:.9} expected_surface_mm2={wanted_surface:.9} {moments} warnings=0",cad.length_unit);
    }
}


// Data-driven, genuinely three-dimensional non-OCCT material witness.
// Unlike fixture-specific Z rays, rays may point in ANY direction. Witness
// expectations are independently authored, never extracted from STEP text.
fn witness_dot(a:[f64;3],b:[f64;3])->f64 {
    a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
}
fn witness_sub(a:[f64;3],b:[f64;3])->[f64;3] {
    [a[0]-b[0],a[1]-b[1],a[2]-b[2]]
}
fn witness_cross(a:[f64;3],b:[f64;3])->[f64;3] {
    [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
}
fn witness_hits(mesh:&Mesh,origin:[f64;3],direction:[f64;3])->Vec<f64> {
    let mut hits=Vec::new();
    for tri in mesh.faces.iter().flat_map(|face|&face.triangles) {
        let a=point(mesh,tri[0]); let b=point(mesh,tri[1]); let c=point(mesh,tri[2]);
        let edge1=witness_sub(b,a); let edge2=witness_sub(c,a);
        let p=witness_cross(direction,edge2);
        let det=witness_dot(edge1,p);
        if det.abs()<1e-12 {continue;}
        let inv=1.0/det;
        let offset=witness_sub(origin,a);
        let u=witness_dot(offset,p)*inv;
        if u < -1e-10 || u > 1.0+1e-10 {continue;}
        let q=witness_cross(offset,edge1);
        let v=witness_dot(direction,q)*inv;
        if v < -1e-10 || u+v > 1.0+1e-10 {continue;}
        let t=witness_dot(edge2,q)*inv;
        if !t.is_finite(){fail("nonfinite witness ray hit");}
        if t.abs()<=1e-7 {fail("witness sample on ambiguous material boundary");}
        if t>0.0 {hits.push(t);}
    }
    hits.sort_by(f64::total_cmp);
    hits.dedup_by(|a,b|(*a-*b).abs()<1e-5);
    hits
}
fn witness_3d(args:&[String]) {
    if args.len()!=4 {fail("usage: --witness-3d ORIGINAL.step INDEPENDENT_WITNESS.txt");}
    if fs::metadata(&args[2]).map(|m|m.len()).unwrap_or(u64::MAX)>50_000_000 {
        fail("missing/oversized physical STEP witness input");
    }
    let specification=fs::read_to_string(&args[3])
        .unwrap_or_else(|_|fail("cannot read independent witness"));
    if specification.len()>100_000 {fail("oversized physical witness");}
    let mut volume_interval:Option<(f64,f64)>=None;
    let mut area_interval:Option<(f64,f64)>=None;
    // V2 adds an independently authored 3D mass-distribution oracle.
    // Preserve the admitted V1 witness format without reinterpretation.
    let mut centroid_intervals:Option<[(f64,f64);3]>=None;
    let mut covariance_intervals:Option<[(f64,f64);6]>=None;
    let mut rays:Vec<(String,[f64;3],[f64;3],bool)>=Vec::new();
    let mut unique=std::collections::HashSet::new();
    let mut version=0;
    for (line_number,line) in specification.lines().enumerate() {
        if line.is_empty(){continue;}
        if line.len()>256 {fail("oversized witness record");}
        let fields:Vec<&str>=line.split_whitespace().collect();
        if version==0 {
            version=match fields.as_slice() {
                ["INTUIT3D_3D_WITNESS_V1"]=>1,
                ["INTUIT3D_3D_WITNESS_V2"]=>2,
                _=>fail("wrong independent 3D witness version"),
            };
            continue;
        }
        match fields.first().copied().unwrap_or("") {
            "VOLUME" | "AREA" if fields.len()==3 => {
                let lower=number(fields[1]); let upper=number(fields[2]);
                if lower<=0.0 || upper<=lower || (upper-lower)/lower>0.02 {
                    fail("independent witness mass/area interval invalid or too broad");
                }
                if fields[0]=="VOLUME" {
                    if volume_interval.replace((lower,upper)).is_some() {
                        fail("duplicate witness volume");
                    }
                }else if area_interval.replace((lower,upper)).is_some(){
                    fail("duplicate witness area");
                }
            }
            "CENTROID" if version==2 && fields.len()==7 => {
                let mut intervals=[(0.0,0.0);3];
                for i in 0..3 {
                    let low=number(fields[1+2*i]);
                    let high=number(fields[2+2*i]);
                    if high<=low || high-low>0.5 {
                        fail("independent 3D centroid interval invalid or too broad");
                    }
                    intervals[i]=(low,high);
                }
                if centroid_intervals.replace(intervals).is_some() {
                    fail("duplicate independent 3D centroid");
                }
            }
            "COVARIANCE" if version==2 && fields.len()==13 => {
                let mut intervals=[(0.0,0.0);6];
                for i in 0..6 {
                    let low=number(fields[1+2*i]);
                    let high=number(fields[2+2*i]);
                    let permitted=0.03*low.abs().max(high.abs()).max(1.0)+0.5;
                    if high<=low || high-low>permitted {
                        fail("independent 3D covariance interval invalid or too broad");
                    }
                    intervals[i]=(low,high);
                }
                if covariance_intervals.replace(intervals).is_some() {
                    fail("duplicate independent 3D covariance");
                }
            }
            "RAY" if fields.len()==9 => {
                let name=fields[1];
                if name.is_empty()||name.len()>56 ||
                    !name.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'.'||c==b'_'||c==b'-')||
                    !unique.insert(name.to_string()) {fail("duplicate/invalid witness ray ID");}
                let origin=[number(fields[2]),number(fields[3]),number(fields[4])];
                let mut direction=[number(fields[5]),number(fields[6]),number(fields[7])];
                let norm=witness_dot(direction,direction).sqrt();
                if !norm.is_finite()||norm<1e-8 {fail("invalid witness direction");}
                for component in &mut direction {*component/=norm;}
                let solid=match fields[8] {
                    "material"=>true,"void"=>false,_=>fail("unknown witness occupancy"),
                };
                rays.push((name.to_string(),origin,direction,solid));
                if rays.len()>256 {fail("too many independent witness rays");}
            }
            _ => fail(&format!("invalid witness command at line {}",line_number+1)),
        }
    }
    if version==2 && (centroid_intervals.is_none() || covariance_intervals.is_none()) {
        fail("V2 independent mass witness requires centroid and full covariance");
    }
    let (vol_min,vol_max)=volume_interval.unwrap_or_else(||fail("missing witness volume"));
    let (area_min,area_max)=area_interval.unwrap_or_else(||fail("missing witness area"));
    if rays.len()<8 {fail("at least eight independently defined 3D rays required");}
    if !rays.iter().any(|a| rays.iter().any(|b|
        witness_dot(a.2,b.2).abs()<0.9)) {
        fail("witness directions lack independent 3D orientation");
    }
    let source=fs::read_to_string(&args[2])
        .unwrap_or_else(|_|fail("cannot read original physical STEP"));
    let cad=import(&source).unwrap_or_else(|e|fail(&format!("independent witness import failed: {e}")));
    if cad.length_unit!="millimetre" && cad.length_unit!="millimeter" {
        fail("independently imported witness STEP is not millimetres");
    }
    if cad.bodies.len()!=1 || !cad.bodies[0].solid ||
        cad.bodies[0].exact.is_none() || !cad.warnings.is_empty(){
        fail("witness import requires precisely one exact warning-free B-rep solid");
    }
    let mesh=&cad.bodies[0].mesh;
    if mesh.vertices.len()<4 || mesh.faces.is_empty(){fail("empty witness solid");}
    let mut edges:HashMap<(u32,u32),usize>=HashMap::new();
    let (mut volume,mut surface,mut triangle_count)=(0.0f64,0.0f64,0usize);
    let mut first_moment=[0.0f64;3];
    let mut second_moment=[0.0f64;6];
    let axes=[(0,0),(1,1),(2,2),(0,1),(0,2),(1,2)];
    for tri in mesh.faces.iter().flat_map(|face|&face.triangles) {
        let a=point(mesh,tri[0]);let b=point(mesh,tri[1]);let c=point(mesh,tri[2]);
        let cross=witness_cross(witness_sub(b,a),witness_sub(c,a));
        let twice_area=witness_dot(cross,cross).sqrt();
        if !twice_area.is_finite()||twice_area<1e-12 {fail("degenerate imported witness triangle");}
        surface+=twice_area/2.0;
        let tetra=witness_dot(a,witness_cross(b,c))/6.0;
        volume+=tetra;
        for i in 0..3 {
            first_moment[i]+=tetra*(a[i]+b[i]+c[i])/4.0;
        }
        for (k,(i,j)) in axes.iter().enumerate() {
            let si=a[*i]+b[*i]+c[*i];
            let sj=a[*j]+b[*j]+c[*j];
            let diagonal=a[*i]*a[*j]+b[*i]*b[*j]+c[*i]*c[*j];
            second_moment[k]+=tetra*(si*sj+diagonal)/20.0;
        }
        triangle_count+=1;
        for i in 0..3{*edges.entry((tri[i],tri[(i+1)%3])).or_default()+=1;}
    }
    if triangle_count<8 ||
        edges.iter().any(|(&(a,b),&n)|n!=1||edges.get(&(b,a))!=Some(&1)) {
        fail("independent witness mesh is not closed/oriented");
    }
    let signed_volume=volume;
    volume=volume.abs();
    if !volume.is_finite() || !surface.is_finite() ||
       !(vol_min<=volume && volume<=vol_max) {
        fail(&format!("WITNESS_GEOMETRY: imported volume {volume} outside [{vol_min},{vol_max}]"));
    }
    if !(area_min<=surface && surface<=area_max) {
        fail(&format!("WITNESS_GEOMETRY: imported area {surface} outside [{area_min},{area_max}]"));
    }
    let moments=if version==2 {
        let expected_centre=centroid_intervals.unwrap();
        let expected_covariance=covariance_intervals.unwrap();
        let mut centre=[0.0f64;3];
        for i in 0..3 {
            centre[i]=first_moment[i]/signed_volume;
            let (low,high)=expected_centre[i];
            if !centre[i].is_finite() || centre[i]<low || centre[i]>high {
                fail(&format!("WITNESS_GEOMETRY: imported centroid axis {i} {:.9} outside [{low},{high}]",centre[i]));
            }
        }
        let mut covariance=[0.0f64;6];
        for (k,(i,j)) in axes.iter().enumerate() {
            covariance[k]=second_moment[k]/signed_volume-centre[*i]*centre[*j];
            let (low,high)=expected_covariance[k];
            if !covariance[k].is_finite() || covariance[k]<low || covariance[k]>high {
                fail(&format!("WITNESS_GEOMETRY: imported covariance component {k} {:.9} outside [{low},{high}]",covariance[k]));
            }
        }
        Some((centre,covariance))
    } else {None};
    for (name,origin,direction,expected) in &rays {
        let hits=witness_hits(mesh,*origin,*direction);
        let material=hits.len()%2==1;
        if material!=*expected {
            fail(&format!("WITNESS_GEOMETRY: ray {name} expected {} but imported {} (hits={})",
                 if *expected{"material"}else{"void"},
                 if material{"material"}else{"void"},hits.len()));
        }
        println!("WITNESS_RAY {name} {} intersections={}",if material{"material"}else{"void"},hits.len());
    }
    if let Some((centre,covariance))=moments {
        println!("WITNESS_MOMENTS centroid_x_mm={:.9} centroid_y_mm={:.9} centroid_z_mm={:.9} cov_xx_mm2={:.9} cov_yy_mm2={:.9} cov_zz_mm2={:.9} cov_xy_mm2={:.9} cov_xz_mm2={:.9} cov_yz_mm2={:.9}",
            centre[0],centre[1],centre[2],covariance[0],covariance[1],
            covariance[2],covariance[3],covariance[4],covariance[5]);
    }
    println!("WITNESS_ACCEPT solids=1 imported_exact=true warnings=0 rays={} triangles={} volume_mm3={:.9} area_mm2={:.9}",
        rays.len(),triangle_count,volume,surface);
}

fn main() {
    if env::args().nth(1).as_deref()==Some("--witness-3d") {
        witness_3d(&env::args().collect::<Vec<_>>()); return;
    }
    if matches!(env::args().nth(1).as_deref(), Some("--sloped-profile" | "--progressive-v6")) {
        sloped_profile(&env::args().collect::<Vec<_>>()); return;
    }
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
