/** Presentation-only radial circle handles. The browser never writes SKETCH
 * constraints directly: accepted values must pass RUNTIME profile admission. */
export type HolePoint = Readonly<{x:number;y:number}>;

/** A 2D pointer produces a positive DIAMETER, irrespective of direction.
 * Values snap to millimetres; Shift provides 0.1 mm precision. */
export function radialHoleDiameter(
  centre:HolePoint, pointer:HolePoint, fine=false,
):number|null {
  if(![centre.x,centre.y,pointer.x,pointer.y].every(Number.isFinite))return null;
  const raw=2*Math.hypot(pointer.x-centre.x,pointer.y-centre.y);
  if(raw>10000)return null;
  const step=fine?0.1:0.5;
  const snapped=Number((Math.round(raw/step)*step).toFixed(5));
  return snapped>=0.5&&snapped<=10000?snapped:null;
}

/** Keyboard-accessible independent +1/-1 mm diameter changes (Shift=0.1). */
export function nudgeHoleDiameter(
  diameter:number,key:string,fine=false,
):number|null {
  if(!['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(key) ||
      !Number.isFinite(diameter))return null;
  const step=fine?0.1:1;
  const sign=key==='ArrowUp'||key==='ArrowRight'?1:-1;
  const next=Number((diameter+sign*step).toFixed(5));
  return next>=0.5&&next<=10000?next:null;
}
