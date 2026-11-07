/** INTUIT3D ASCII DXF R2000 2D sketch exchange. Internal coordinates are mm. */
export const DXF_INTERCHANGE_VERSION=1;
export class DxfInterchangeError extends Error {
  constructor(code,message){super('DXF '+code+': '+message);this.name='DxfInterchangeError';this.code=code;}
}
const fail=(c,m)=>{throw new DxfInterchangeError(c,m);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const copy=x=>JSON.parse(JSON.stringify(x));
const num=(v,label)=>{
  if(typeof v!=='string'||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(v.trim()))
    fail('invalid_number',label);
  const n=Number(v);if(!finite(n))fail('invalid_number',label);return n;
};
const norm=a=>((a%360)+360)%360;
const layerOK=x=>typeof x==='string'&&x.length>0&&x.length<=255&&!/[\x00-\x1f<>\/\\":;?*|=]/.test(x);
const pointOK=p=>p&&finite(p.x)&&finite(p.y);
const distinct=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)>0;
export function validateDxfSketch(d){
  if(!d||d.version!==1||d.units!=='mm'||!['mm','in'].includes(d.sourceUnits)||
     !Array.isArray(d.entities)||d.entities.length>2048)fail('invalid_document','bounded v1 mm sketch required');
  const ids=new Set();
  for(const e of d.entities){
    if(!e||typeof e!=='object'||!/^[A-Za-z][\w.:-]{0,127}$/.test(e.id)||ids.has(e.id)||!layerOK(e.layer))
      fail('invalid_entity','entity identity/layer');
    ids.add(e.id);
    if(e.kind==='line'){
      if(!pointOK(e.start)||!pointOK(e.end)||!distinct(e.start,e.end))fail('invalid_line',e.id);
    }else if(e.kind==='circle'){
      if(!pointOK(e.center)||!finite(e.radiusMm)||e.radiusMm<=0)fail('invalid_circle',e.id);
    }else if(e.kind==='arc'){
      if(!pointOK(e.center)||!finite(e.radiusMm)||e.radiusMm<=0||
         !finite(e.startAngleDeg)||!finite(e.endAngleDeg)||
         norm(e.endAngleDeg-e.startAngleDeg)<=1e-9||
         norm(e.endAngleDeg-e.startAngleDeg)>=360-1e-9)fail('invalid_arc',e.id);
    }else fail('unsupported_entity',String(e.kind));
    if(e.sourceHandle!==undefined && (typeof e.sourceHandle!=='string'||!/^[A-Fa-f0-9]+$/.test(e.sourceHandle)))
      fail('invalid_handle',e.id);
    if(e.sourceEntity!==undefined && !['LINE','ARC','CIRCLE','LWPOLYLINE'].includes(e.sourceEntity))
      fail('invalid_provenance',e.id);
  }
  return copy(d);
}
function pairsOf(s){
  if(typeof s!=='string'||s.length>2000000||/[^\x09\x0a\x0d\x20-\x7e]/.test(s))
    fail('invalid_input','ASCII text <=2MB required');
  const lines=s.split(/\r\n|\r|\n/);
  if(lines[lines.length-1]==='')lines.pop();
  if(lines.length%2)fail('malformed_groups','odd code/value line count');
  const p=[];
  for(let i=0;i<lines.length;i+=2){
    if(!/^-?\d+$/.test(lines[i].trim()))fail('malformed_groups','line '+(i+1));
    p.push({c:Number(lines[i].trim()),v:lines[i+1].trim()});
  }
  return p;
}
function one(p,c,required=true,defaultValue=null){
  const found=p.filter(x=>x.c===c);
  if(found.length>1)fail('duplicate_group',String(c));
  if(!found.length){if(required)fail('missing_group',String(c));return defaultValue;}
  return found[0].v;
}
const f=(p,c,req=true,def=0)=>num(one(p,c,req,String(def)),String(c));
function planar(p){
  for(const code of [30,31,38])if(p.some(x=>x.c===code)&&Math.abs(f(p,code))>1e-10)
    fail('nonplanar_entity','nonzero Z');
  for(const [c,v] of [[210,0],[220,0],[230,1]])
    if(p.some(x=>x.c===c)&&Math.abs(f(p,c)-v)>1e-10)fail('nonplanar_entity','extrusion normal');
}
function bulgeArc(a,b,bulge,id,meta){
  if(!finite(bulge)||Math.abs(bulge)>1+1e-12||Math.abs(bulge)<1e-12)
    fail('unsupported_bulge','only minor/semicircle bulges');
  const dx=b.x-a.x,dy=b.y-a.y,chord=Math.hypot(dx,dy);
  if(chord<=0)fail('invalid_polyline','zero-length segment');
  const cx=(a.x+b.x)/2-dy*(1-bulge*bulge)/(4*bulge);
  const cy=(a.y+b.y)/2+dx*(1-bulge*bulge)/(4*bulge);
  const start=bulge>0?a:b,end=bulge>0?b:a;
  return {id,kind:'arc',center:{x:cx,y:cy},
    radiusMm:chord*(1+bulge*bulge)/(4*Math.abs(bulge)),
    startAngleDeg:norm(Math.atan2(start.y-cy,start.x-cx)*180/Math.PI),
    endAngleDeg:norm(Math.atan2(end.y-cy,end.x-cx)*180/Math.PI),...meta};
}
function entity(kind,p,index,scale){
  const layer=one(p,8,false,'0'),handle=one(p,5,false,null),id='e'+index;
  if(!layerOK(layer))fail('invalid_layer',kind);
  if(handle!==null&&!/^[A-Fa-f0-9]+$/.test(handle))fail('invalid_handle',kind);
  planar(p);
  const meta={layer,sourceEntity:kind,...(handle?{sourceHandle:handle}:{})};
  const xy=(x,y)=>({x:x*scale,y:y*scale});
  if(kind==='LINE')return [{id,kind:'line',start:xy(f(p,10),f(p,20)),end:xy(f(p,11),f(p,21)),...meta}];
  if(kind==='CIRCLE')return [{id,kind:'circle',center:xy(f(p,10),f(p,20)),radiusMm:f(p,40)*scale,...meta}];
  if(kind==='ARC')return [{id,kind:'arc',center:xy(f(p,10),f(p,20)),
    radiusMm:f(p,40)*scale,startAngleDeg:f(p,50),endAngleDeg:f(p,51),...meta}];
  if(kind==='LWPOLYLINE'){
    const flags=f(p,70,false),count=f(p,90);
    if(flags!==1||!Number.isSafeInteger(count)||count<3||count>256)
      fail('unsupported_polyline','closed, simple 3..256 vertices required');
    if(p.some(x=>[39,40,41,43].includes(x.c)))fail('unsupported_polyline','width/thickness');
    const vs=[];
    for(const t of p){
      if(t.c===10)vs.push({x:num(t.v,'polyline X')*scale,y:null,bulge:0});
      else if(t.c===20){
        if(!vs.length||vs[vs.length-1].y!==null)fail('invalid_polyline','misordered Y');
        vs[vs.length-1].y=num(t.v,'polyline Y')*scale;
      }else if(t.c===42){
        if(!vs.length)fail('invalid_polyline','misordered bulge');
        vs[vs.length-1].bulge=num(t.v,'polyline bulge');
      }
    }
    if(vs.length!==count||vs.some(v=>!finite(v.y)))fail('invalid_polyline','missing vertex');
    const result=[];
    for(let i=0;i<count;i++){
      const a=vs[i],b=vs[(i+1)%count],sid=id+'.s'+i;
      if(!distinct(a,b))fail('invalid_polyline','zero-length edge');
      const props={...meta};
      result.push(Math.abs(a.bulge)<1e-12?
        {id:sid,kind:'line',start:{x:a.x,y:a.y},end:{x:b.x,y:b.y},...props}:
        bulgeArc(a,b,a.bulge,sid,props));
    }
    return result;
  }
  fail('unsupported_entity',kind);
}
/** Bounded WCS planar model-space subset; no INSERT, BLOCKS, splines or 3D. */
export function importAsciiDxf(text){
  const p=pairsOf(text);let i=0,units=null,acadver=null,entities=[],found=false;
  const expect=(c,v)=>{if(!p[i]||p[i].c!==c||p[i].v!==v)fail('malformed_sections','expected '+v);i++;};
  while(i<p.length){
    if(p[i].c===0&&p[i].v==='EOF'){i++;break;}
    expect(0,'SECTION');
    if(p[i]?.c!==2)fail('malformed_sections','section name missing');
    const section=p[i++].v;
    if(section==='HEADER'){
      while(i<p.length&&!(p[i].c===0&&p[i].v==='ENDSEC')){
        if(p[i].c===9&&p[i].v==='$INSUNITS'){
          i++;if(p[i]?.c!==70)fail('missing_units','$INSUNITS group 70');
          units=num(p[i++].v,'INSUNITS');continue;
        }
        if(p[i].c===9&&p[i].v==='$ACADVER'){
          i++;if(p[i]?.c!==1)fail('invalid_header','$ACADVER');
          acadver=p[i++].v;continue;
        }
        i++;
      }
    }else if(section==='ENTITIES'){
      if(found)fail('malformed_sections','duplicate entities');found=true;
      while(i<p.length&&!(p[i].c===0&&p[i].v==='ENDSEC')){
        if(p[i].c!==0)fail('malformed_entity','missing 0 marker');
        const kind=p[i++].v,values=[];
        while(i<p.length&&p[i].c!==0)values.push(p[i++]);
        if(!['LINE','CIRCLE','ARC','LWPOLYLINE'].includes(kind))fail('unsupported_entity',kind);
        if(units!==1&&units!==4)fail('missing_units','HEADER must precede ENTITIES with 1 or 4');
        entities.push(...entity(kind,values,entities.length+1,units===1?25.4:1));
        if(entities.length>2048)fail('entity_limit','too many entities');
      }
    }else{
      while(i<p.length&&!(p[i].c===0&&p[i].v==='ENDSEC'))i++;
    }
    expect(0,'ENDSEC');
  }
  if(i!==p.length||!found||!entities.length)fail('malformed_sections','EOF or entities missing');
  if(acadver&&!['AC1015','AC1018','AC1021','AC1024','AC1027','AC1032'].includes(acadver))
    fail('unsupported_version',acadver);
  if(units!==1&&units!==4)fail('unsupported_units','explicit mm/in $INSUNITS required');
  return validateDxfSketch({version:1,units:'mm',sourceUnits:units===4?'mm':'in',entities});
}
/** Deterministic standalone ASCII DXF; numerical geometry remains analytic. */
export function exportAsciiDxf(source,{units}={}){
  const d=validateDxfSketch(source),to=units??d.sourceUnits;
  if(!['mm','in'].includes(to))fail('unsupported_units',String(to));
  const scale=to==='in'?1/25.4:1,g=[];
  const emit=(c,v)=>g.push(String(c),String(v));
  const n=v=>{if(!finite(v))fail('invalid_number','export');return Object.is(v,-0)?'0':String(v);};
  emit(0,'SECTION');emit(2,'HEADER');emit(9,'$ACADVER');emit(1,'AC1015');
  emit(9,'$INSUNITS');emit(70,to==='mm'?4:1);emit(0,'ENDSEC');
  emit(0,'SECTION');emit(2,'TABLES');emit(0,'TABLE');emit(2,'LAYER');
  const layers=[...new Set(['0',...d.entities.map(e=>e.layer)])].sort();
  emit(70,layers.length);
  for(const layer of layers){
    emit(0,'LAYER');emit(2,layer);emit(70,0);emit(62,7);emit(6,'CONTINUOUS');
  }
  emit(0,'ENDTAB');emit(0,'ENDSEC');emit(0,'SECTION');emit(2,'ENTITIES');
  for(const [i,e] of d.entities.entries()){
    emit(0,e.kind.toUpperCase());emit(5,(i+256).toString(16).toUpperCase());emit(8,e.layer);
    const origin=e.kind==='line'?e.start:e.center;
    emit(10,n(origin.x*scale));emit(20,n(origin.y*scale));
    if(e.kind==='line'){emit(11,n(e.end.x*scale));emit(21,n(e.end.y*scale));}
    else emit(40,n(e.radiusMm*scale));
    if(e.kind==='arc'){emit(50,n(norm(e.startAngleDeg)));emit(51,n(norm(e.endAngleDeg)));}
  }
  emit(0,'ENDSEC');emit(0,'EOF');
  return g.join('\r\n')+'\r\n';
}
