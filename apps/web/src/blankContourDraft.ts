/** Ephemeral pointer vertices. SKETCH is the only geometry admission authority. */
export interface SketchLocalPoint { readonly x:number; readonly y:number }
export interface BlankContourDraft {
  readonly projectId:string;
  readonly revision:number;
  readonly expectedArchive:string;
  readonly expectedSketchSignature:string;
  readonly contourId:string;
  readonly vertices:readonly SketchLocalPoint[];
}
export const MAX_BLANK_CONTOUR_VERTICES=12;
export type AppendContourResult =
  | Readonly<{kind:'added';draft:BlankContourDraft}>
  | Readonly<{kind:'refused';reason:string}>;

export function beginBlankContourDraft(source:Omit<BlankContourDraft,'vertices'>):BlankContourDraft {
  if(!source.projectId||!source.contourId||!source.expectedArchive||
      !source.expectedSketchSignature||!Number.isSafeInteger(source.revision)||source.revision<0)
    throw Error('A blank contour requires a source-bound authoritative sketch.');
  return {...source,vertices:[]};
}
export function appendBlankContourPoint(draft:BlankContourDraft,point:SketchLocalPoint):AppendContourResult {
  if(draft.vertices.length>=MAX_BLANK_CONTOUR_VERTICES)
    return {kind:'refused',reason:'Maximum 12 vertices reached. Close or cancel the outline.'};
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||
      Math.abs(point.x)>10000||Math.abs(point.y)>10000)
    return {kind:'refused',reason:'Sketch coordinates must be finite and within 10,000 mm.'};
  // Repeated vertices are not a profile. Crossing/collinearity is still
  // checked by the authoritative SKETCH contour provider when Close is used.
  if(draft.vertices.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<0.01))
    return {kind:'refused',reason:'Vertex repeats an existing point (0.01 mm minimum clearance).'};
  return {kind:'added',draft:{...draft,vertices:[...draft.vertices,{x:point.x,y:point.y}]}};
}
export function undoBlankContourVertex(draft:BlankContourDraft):BlankContourDraft {
  return {...draft,vertices:draft.vertices.slice(0,-1)};
}
export function canCloseBlankContour(draft:BlankContourDraft|null):boolean {
  return !!draft&&draft.vertices.length>=3;
}

/** Browser-only pointer quantization; does not admit or modify solver geometry.
 * Normal clicks meet the visible 1 mm construction grid. Holding Shift
 * uses the former 0.001 mm pointer resolution for off-grid features.
 * Out-of-bounds raw clicks refuse rather than snapping into the workspace.
 */
export function placeBlankContourPointer(point:SketchLocalPoint,shiftFine=false):SketchLocalPoint|null {
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||
     Math.abs(point.x)>10000||Math.abs(point.y)>10000)return null;
  const scale=shiftFine?1000:1;
  // Symmetric half-away-from-zero quantization avoids direction-dependent
  // snapping for negative sketch coordinates. Do not leave a signed -0.
  const quantize=(value:number)=>Math.sign(value)*Math.round(Math.abs(value)*scale)/scale||0;
  return {x:quantize(point.x),y:quantize(point.y)};
}
