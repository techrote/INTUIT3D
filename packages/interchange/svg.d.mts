import type {DxfSketch} from './dxf.mjs';
export const SVG_INTERCHANGE_VERSION:1;
/** Self-contained millimetre-scaled, analytic-arc SVG visualization, not a CAD authority. */
export function renderDxfSketchSvg(
  source:DxfSketch,options?:{paddingMm?:number;strokeWidthMm?:number}
):string;
