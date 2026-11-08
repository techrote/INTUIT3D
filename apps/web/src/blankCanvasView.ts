/** Ephemeral blank-canvas navigation. This changes only the SVG viewport,
 * never solver coordinates, closed-contour draft vertices or model history. */
export interface BlankCanvasView {
  readonly x:number;
  readonly y:number;
  readonly width:number;
  readonly height:number;
}
export const DEFAULT_BLANK_CANVAS_VIEW:BlankCanvasView={
  x:-20,y:-20,width:240,height:160,
};
export const MIN_BLANK_CANVAS_WIDTH=30;
export const MAX_BLANK_CANVAS_WIDTH=4000;

/** Zoom about an SVG-space point, keeping that point fixed on screen.
 * Clamp the scale while preserving the original 3:2 viewBox aspect ratio. */
export function zoomBlankCanvas(
  view:BlankCanvasView,anchor:{x:number;y:number},factor:number,
):BlankCanvasView {
  if(!Number.isFinite(factor)||factor<=0||
     !Number.isFinite(anchor.x)||!Number.isFinite(anchor.y))return view;
  const width=Math.min(MAX_BLANK_CANVAS_WIDTH,
    Math.max(MIN_BLANK_CANVAS_WIDTH,view.width*factor));
  const ratio=width/view.width;
  return {
    x:anchor.x-(anchor.x-view.x)*ratio,
    y:anchor.y-(anchor.y-view.y)*ratio,
    width,height:view.height*ratio,
  };
}

/** Positive pointer movement pans the displayed sketch in that direction.
 * Both deltas must be transformed with the SVG's starting screen inverse,
 * not its changing current screen matrix. */
export function panBlankCanvas(
  origin:BlankCanvasView,delta:{x:number;y:number},
):BlankCanvasView {
  if(!Number.isFinite(delta.x)||!Number.isFinite(delta.y))return origin;
  return {...origin,x:origin.x-delta.x,y:origin.y-delta.y};
}
