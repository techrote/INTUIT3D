/** WORKBENCH-only direct-manipulation math. Never becomes sketch authority:
 * committed edits must pass through the real INTENT/SKETCH/RUNTIME journal. */
export type SketchDimensionHandle = 'width' | 'depth' | 'holeA.diameter' | 'holeB.diameter';
export type SketchPoint = Readonly<{x:number;y:number}>;
export type SketchBounds = Readonly<{minX:number;minY:number;maxX:number;maxY:number}>;
export type SketchHoleCenters = Readonly<Record<'holeA'|'holeB',SketchPoint>>;

export function snapHandleMillimetres(raw:number,fine=false):number|null {
  if(!Number.isFinite(raw))return null;
  const step=fine?0.1:0.5;
  const value=Number((Math.round(raw/step)*step).toFixed(4));
  return value>0 && value<=10000?value:null;
}

/** Converts an actual sketch-space pointer into ONE authored dimension.
 * Width and depth use the left/bottom plate datum; diameter uses a hole's
 * right-hand radial handle. No implicit symmetric resize or body translation. */
export function handleDimensionAtPoint(
  handle:SketchDimensionHandle, point:SketchPoint,
  bounds:SketchBounds, centers:SketchHoleCenters, fine=false,
):number|null {
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
  switch(handle) {
    case 'width': return snapHandleMillimetres(point.x-bounds.minX,fine);
    case 'depth': return snapHandleMillimetres(point.y-bounds.minY,fine);
    case 'holeA.diameter': return snapHandleMillimetres(2*(point.x-centers.holeA.x),fine);
    case 'holeB.diameter': return snapHandleMillimetres(2*(point.x-centers.holeB.x),fine);
  }
}

/** Accessible keyboard nudging is an independent one-step semantic edit. */
export function nudgeSketchHandle(
  handle:SketchDimensionHandle, value:number, key:string, fine=false,
):number|null {
  const vertical=handle==='depth';
  const positive=vertical?'ArrowUp':'ArrowRight';
  const negative=vertical?'ArrowDown':'ArrowLeft';
  if(key!==positive && key!==negative)return null;
  const step=fine?0.1:1;
  return snapHandleMillimetres(value+(key===positive?step:-step),fine);
}
