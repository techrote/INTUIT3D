/**
 * INTUIT3D Engineering v1 — derived 2D measurements and dimensioned A3 sheets.
 * Project history and sketch constraints remain authoritative in their owners.
 * No native B-rep, 3D mass properties, or independent STEP claims.
 */
import {deserializeProject, planProject} from '../model/src/index.ts';
import {parseSketch} from '../sketch/index.mjs';
import {inspectCenteredHolePlate} from '../sketch/centered-hole-plate.mjs';

export const ENGINEERING_DRAWING_VERSION = 1;
export const ENGINEERING_DRAWING_FORMAT = 'intuit3d.engineering.plate-sheet';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const fmt = n => {
  if (!finite(n)) throw new TypeError('drawing: nonfinite measurement');
  return String(Number(n.toFixed(6)));
};
const xml = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));
const dist = (a,b) => Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
const required = (ok, reason) => {if (!ok) throw new TypeError('drawing: '+reason);};

/**
 * Read a genuine, serialized INTENT project whose sketch feature carries the
 * accepted SKETCH v1 serialized document in payload.sketchDocument.
 * Uses INTENT's own history replay and SKETCH's own solve/profile guard;
 * there is no alternative project or geometry solver in this package.
 */
export function measurePlateFromProject({projectJson, sketchFeatureId, profileId}) {
  required(typeof projectJson === 'string', 'serialized project required');
  required(typeof sketchFeatureId === 'string' && sketchFeatureId.length > 0,
    'sketch feature ID required');
  required(typeof profileId === 'string' && profileId.length > 0, 'profile ID required');
  const project = deserializeProject(projectJson);
  const plan = planProject(project);
  const entry = plan.features.find(f => f.feature.id === sketchFeatureId);
  required(entry && entry.status === 'ready', 'sketch feature is missing or not ready');
  required(entry.feature.kind === 'sketch', 'target feature is not a sketch');
  required(typeof entry.feature.payload.sketchDocument === 'string',
    'sketch feature has no serialized sketchDocument');
  const sketch = parseSketch(entry.feature.payload.sketchDocument);
  const inspection = inspectCenteredHolePlate(sketch, profileId);
  required(inspection.status === 'solved' &&
    inspection.solution.status === 'solved' && inspection.profile,
    'profile is not solved and analytically admitted: '+(inspection.reason ?? inspection.status));
  const profile = inspection.profile;
  required(profile.status === 'analytic_profile_only' && profile.units === 'mm',
    'unsupported sketch profile or units');
  const xs = profile.outer.map(p=>p.x), ys = profile.outer.map(p=>p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs),
    minY = Math.min(...ys), maxY = Math.max(...ys);
  const widthMm = maxX-minX, heightMm = maxY-minY;
  required(finite(widthMm) && finite(heightMm) && widthMm > 0 && heightMm > 0,
    'invalid profile extents');
  const holes = profile.holes.map(h=>({
    id:h.id, centerId:h.centerId,
    xMm:h.x, yMm:h.y,
    offsetXmm:h.x-minX, offsetYmm:h.y-minY,
    radiusMm:h.radius, diameterMm:2*h.radius
  }));
  const [a,b] = holes;
  required(holes.length === 2 && holes.every(h=>
    Object.values(h).every(v=>typeof v !== 'number' || finite(v))),
    'only centered-hole two-hole plate supported in drawing v1');
  return {
    format:ENGINEERING_DRAWING_FORMAT, version:ENGINEERING_DRAWING_VERSION,
    status:'analytic_sketch_only', units:'mm', nativeExact:false,
    independentStepQualified:false,
    provenance:{projectId:project.projectId, projectRevision:project.revision,
      sketchFeatureId, profileId:inspection.profileId,
      sketchSignature:inspection.sourceSignature, solverStatus:inspection.solution.status},
    bounds:{minX,minY,maxX,maxY}, widthMm,heightMm,
    boundary:profile.outer.map(p=>({id:p.id,xMm:p.x,yMm:p.y})),
    holes, holePitchMm:dist(a,b),
    analyticAreaMm2:profile.areaMm2
  };
}

/**
 * Standalone SVG A3 landscape engineering sheet. 1 sheet unit = 1 physical
 * millimetre; the drawing's declared scale is explicit when it must shrink.
 * Text, dimensions, centre marks and table are presentation-derived only.
 */
export function renderPlateDrawingSvg(measurement,{title='MOUNTING PLATE', drawingId='PLATE-001'}={}) {
  required(measurement?.format === ENGINEERING_DRAWING_FORMAT &&
    measurement.version === 1 && measurement.status === 'analytic_sketch_only',
    'unsupported measurement/provenance');
  required(typeof title === 'string' && title.length <= 100 &&
    typeof drawingId === 'string' && drawingId.length <= 80,
    'invalid drawing title or ID');
  const m=measurement, b=m.bounds;
  const scale=Math.min(1, 180/m.widthMm, 96/m.heightMm);
  required(finite(scale) && scale > 0, 'unrepresentable layout');
  const w=m.widthMm*scale, h=m.heightMm*scale;
  const left=70+(190-w)/2, top=75+(104-h)/2, right=left+w, bottom=top+h;
  const X=x=>left+(x-b.minX)*scale;
  const Y=y=>top+(b.maxY-y)*scale;
  const L=(x1,y1,x2,y2,cls='thin') =>
    '<line class="'+cls+'" x1="'+fmt(x1)+'" y1="'+fmt(y1)+
    '" x2="'+fmt(x2)+'" y2="'+fmt(y2)+'"/>';
  const T=(x,y,value,cls='small',anchor='middle') =>
    '<text class="'+cls+'" x="'+fmt(x)+'" y="'+fmt(y)+
    '" text-anchor="'+anchor+'">'+xml(value)+'</text>';
  const detail=[];
  const vertices=m.boundary.map(p=>fmt(X(p.xMm))+','+fmt(Y(p.yMm))).join(' ');
  detail.push('<polygon class="outline" points="'+vertices+'" fill="none"/>');
  for(let i=0;i<m.holes.length;i++){
    const hole=m.holes[i],cx=X(hole.xMm),cy=Y(hole.yMm),r=hole.radiusMm*scale;
    detail.push('<circle class="outline" data-entity="'+xml(hole.id)+
      '" cx="'+fmt(cx)+'" cy="'+fmt(cy)+'" r="'+fmt(r)+'"/>');
    detail.push(L(cx-8,cy,cx+8,cy,'center'));
    detail.push(L(cx,cy-8,cx,cy+8,'center'));
    detail.push('<circle class="datum" cx="'+fmt(cx)+'" cy="'+fmt(cy)+'" r="1"/>');
    detail.push(T(cx,cy-r-4,'H'+(i+1),'small'));
  }
  // Horizontal and vertical dimension rails, with extension lines.
  const yd=top-20, xd=left-20;
  detail.push(L(left,top-3,left,yd-5,'thin'),L(right,top-3,right,yd-5,'thin'));
  detail.push(L(left,yd,right,yd,'dimension'));
  detail.push(T((left+right)/2,yd-4,fmt(m.widthMm)+' mm','dimension-label'));
  detail.push(L(left,top,xd-5,top,'thin'),L(left,bottom,xd-5,bottom,'thin'));
  detail.push(L(xd,top,xd,bottom,'dimension'));
  detail.push('<text class="dimension-label" transform="translate('+fmt(xd-4)+' '+
    fmt((top+bottom)/2)+') rotate(-90)" text-anchor="middle">'+fmt(m.heightMm)+' mm</text>');
  // Hole-centre pitch rail; placed below the outside contour.
  const pitchY=bottom+20, a=m.holes[0],c=m.holes[1];
  const ax=X(a.xMm), bx=X(c.xMm), leftHole=Math.min(ax,bx),rightHole=Math.max(ax,bx);
  detail.push(L(leftHole,Y(a.yMm)+7,leftHole,pitchY+3,'thin'));
  detail.push(L(rightHole,Y(c.yMm)+7,rightHole,pitchY+3,'thin'));
  detail.push(L(leftHole,pitchY,rightHole,pitchY,'dimension'));
  detail.push(T((leftHole+rightHole)/2,pitchY+7,'PITCH '+fmt(m.holePitchMm)+' mm','small'));
  // Projection of centreline; not a geometric feature of the part.
  detail.push(L(left-7,Y(a.yMm),right+7,Y(a.yMm),'center'));
  const rows=[
    ['HOLE','X from left','Y from bottom','DIAMETER'],
    ...m.holes.map((hole,i)=>[
      'H'+(i+1)+' ('+hole.id+')',
      fmt(hole.offsetXmm)+' mm',fmt(hole.offsetYmm)+' mm',
      '\u00d8'+fmt(hole.diameterMm)+' mm'
    ])
  ];
  const table=[];
  table.push('<rect class="panel" x="286" y="65" width="119" height="111" rx="1"/>');
  table.push(T(292,76,'HOLE LOCATION TABLE','label','start'));
  table.push(L(291,82,400,82));
  const cols=[292,315,347,377];
  rows.forEach((row,i)=>{
    const y=91+17*i;
    if(i===0){table.push(T(292,y,'ID','tiny','start'),
      T(317,y,'X','tiny','start'),T(347,y,'Y','tiny','start'),
      T(379,y,'DIA','tiny','start'));}
    else{
      table.push(T(cols[0],y,'H'+i,'small','start'),
        T(cols[1],y,fmt(m.holes[i-1].offsetXmm),'small','start'),
        T(cols[2],y,fmt(m.holes[i-1].offsetYmm),'small','start'),
        T(cols[3],y,'\u00d8'+fmt(m.holes[i-1].diameterMm),'small','start'));
    }
  });
  table.push(L(291,145,400,145),T(292,156,'X/Y DATUM: LOWER LEFT','tiny','start'));
  table.push(T(292,167,'ALL DIMENSIONS IN mm','tiny','start'));
  const meta={format:m.format, version:m.version, status:m.status,
    units:m.units, provenance:m.provenance, scale, nativeExact:false,
    independentStepQualified:false};
  const sheet=[
    '<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297" role="img">',
    '<title>'+xml(title+' — '+drawingId)+'</title>',
    '<metadata>'+xml(JSON.stringify(meta))+'</metadata>',
    '<style>',
    '.border{stroke:#28384b;stroke-width:.55;fill:none}',
    '.outline{stroke:#111c29;stroke-width:.7;fill:none}',
    '.thin{stroke:#647d91;stroke-width:.24;fill:none}',
    '.center{stroke:#31818b;stroke-width:.22;stroke-dasharray:5 2 1 2;fill:none}',
    '.dimension{stroke:#273849;stroke-width:.3;fill:none;marker-start:url(#arr);marker-end:url(#arr)}',
    '.datum{fill:#fff;stroke:#198d96;stroke-width:.4}',
    '.panel{fill:#f5f8fa;stroke:#cad4de;stroke-width:.35}',
    'text{font-family:Arial,Helvetica,sans-serif;fill:#24354a}',
    '.small{font-size:3.3px}.tiny{font-size:2.8px}',
    '.label{font-size:4.2px;font-weight:700}',
    '.dimension-label{font-size:4.2px;font-weight:600}',
    '.heading{font-size:8px;font-weight:700;letter-spacing:.8px}',
    '</style>',
    '<defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#273849"/></marker></defs>',
    '<rect x="0" y="0" width="420" height="297" fill="white"/>',
    '<rect class="border" x="10" y="10" width="400" height="277"/>',
    '<rect class="border" x="14" y="14" width="392" height="269"/>',
    T(22,29,'INTUIT3D / ENGINEERING INSPECTION','heading','start'),
    T(22,37,'DIMENSIONED TOP VIEW   \u00b7   ANALYTIC SKETCH ONLY','small','start'),
    L(20,44,400,44),
    ...detail, ...table,
    '<rect class="panel" x="20" y="227" width="380" height="48"/>',
    L(280,227,280,275), L(20,244,400,244),L(20,260,400,260),
    T(27,239,title,'label','start'),
    T(27,254,'DRAWING: '+drawingId,'small','start'),
    T(27,270,'PROJECT: '+m.provenance.projectId,'small','start'),
    T(287,239,'TOP VIEW  /  SCALE 1:'+fmt(1/scale),'small','start'),
    T(287,254,'PROJECT REV: '+m.provenance.projectRevision,'small','start'),
    T(287,270,'STATUS: SKETCH / NOT NATIVE','small','start'),
    T(20,285,'INFORMATIONAL 2D DRAWING. NOT A QUALIFIED B-REP, STEP OR MANUFACTURING CERTIFICATE.','tiny','start'),
    '</svg>'
  ];
  return sheet.join('\n')+'\n';
}

/** Small consumer boundary: measurement and SVG are derived, never saved as intent. */
export function createDimensionedPlateSheet(request) {
  const {title,drawingId,...source}=request ?? {};
  const measurement=measurePlateFromProject(source);
  const svg=renderPlateDrawingSvg(measurement,{title,drawingId});
  return {format:ENGINEERING_DRAWING_FORMAT,version:1,
    mimeType:'image/svg+xml',filename:(drawingId??'plate').replace(/[^a-zA-Z0-9._-]/g,'_')+'.svg',
    measurement,svg};
}
