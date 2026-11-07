/** Transient two-click circle drafting. This never creates a CAD feature.
 * Only the caller's RUNTIME/SKETCH admission commits an authored revision. */
export type CircleDrawingState =
  | {readonly phase:'idle'}
  | {readonly phase:'centre'}
  | {readonly phase:'radius';readonly center:Readonly<{x:number;y:number}>};
export type SketchPoint = Readonly<{x:number;y:number}>;
export type CircleDrawingStep = CircleDrawingState
  | {readonly phase:'complete';readonly circle:Readonly<{x:number;y:number;diameter:number}>}
  | {readonly phase:'refused';readonly reason:string};

const snap=(n:number)=>Math.round(n*2)/2;
const inRange=(point:SketchPoint)=>
  Number.isFinite(point.x)&&Number.isFinite(point.y)&&
  Math.abs(point.x)<=10000&&Math.abs(point.y)<=10000;

export function circleDrawingPreview(state:CircleDrawingState,point:SketchPoint):
  {x:number;y:number;radius:number}|null {
  if(!inRange(point)||state.phase==='idle')return null;
  if(state.phase==='centre')return {x:snap(point.x),y:snap(point.y),radius:0};
  return {x:state.center.x,y:state.center.y,
    radius:snap(Math.hypot(point.x-state.center.x,point.y-state.center.y))};
}

export function nextCircleDrawing(state:CircleDrawingState,point:SketchPoint):CircleDrawingStep {
  if(state.phase==='idle')return {phase:'refused',reason:'Select Draw circle first.'};
  if(!inRange(point))return {phase:'refused',reason:'Circle location must be finite and within ±10,000 mm.'};
  if(state.phase==='centre')return {phase:'radius',center:{x:snap(point.x),y:snap(point.y)}};
  const radius=snap(Math.hypot(point.x-state.center.x,point.y-state.center.y));
  if(!Number.isFinite(radius)||radius<0.5||radius>5000)
    return {phase:'refused',reason:'Click at least 0.5 mm from the centre; maximum radius is 5,000 mm.'};
  return {phase:'complete',circle:{...state.center,diameter:2*radius}};
}
