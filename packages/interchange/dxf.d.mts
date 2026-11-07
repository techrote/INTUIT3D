export const DXF_INTERCHANGE_VERSION:1;
export class DxfInterchangeError extends Error {code:string;constructor(code:string,message:string);}
export type DxfPoint={x:number;y:number};
export type DxfProvenance={sourceHandle?:string;sourceEntity?:'LINE'|'CIRCLE'|'ARC'|'LWPOLYLINE'};
export type DxfLine={id:string;kind:'line';layer:string;start:DxfPoint;end:DxfPoint} & DxfProvenance;
export type DxfCircle={id:string;kind:'circle';layer:string;center:DxfPoint;radiusMm:number} & DxfProvenance;
export type DxfArc={id:string;kind:'arc';layer:string;center:DxfPoint;radiusMm:number;
 startAngleDeg:number;endAngleDeg:number} & DxfProvenance;
export type DxfEntity=DxfLine|DxfCircle|DxfArc;
export interface DxfSketch {
 version:1;units:'mm';sourceUnits:'mm'|'in';entities:DxfEntity[];
}
export function validateDxfSketch(source:unknown):DxfSketch;
/** ASCII DXF AC1015+; planar LINE/CIRCLE/ARC/closed LWPOLYLINE, explicit $INSUNITS 1/4. */
export function importAsciiDxf(source:string):DxfSketch;
/** Deterministic ASCII R2000 DXF; source units retained unless explicitly overridden. */
export function exportAsciiDxf(source:DxfSketch,options?:{units?:'mm'|'in'}):string;
