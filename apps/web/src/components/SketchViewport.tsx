import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import { type Document, type DimensionKey } from '../model';

interface Props {
  document: Document;
  onChange: (key: DimensionKey, value: number) => void;
  onSelect: (id: string) => void;
}
const W = 1000;
const H = 650;

/** Scaled 2D sketch-intent visualization, not a constraint solver. */
export function SketchViewport({ document, onChange, onSelect }: Props) {
  const { width, depth, holeDiameter, holeSpacing } = document.params;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; spacing: number; scale: number } | null>(null);
  const scale = Math.min(4.6, 660 / Math.max(1, width), 410 / Math.max(1, depth));
  const left = W / 2 - width * scale / 2;
  const top = H / 2 - depth * scale / 2;
  const radius = holeDiameter * scale / 2;
  const span = holeSpacing * scale / 2;

  const getSvgX = (event: ReactPointerEvent<SVGElement>) => {
    const element = svg.current;
    if (!element) return W / 2;
    const point = element.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = element.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()).x : W / 2;
  };
  const begin = (event: ReactPointerEvent<SVGCircleElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: getSvgX(event), spacing: holeSpacing, scale };
    onSelect('sketch-holes');
  };
  const move = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag.current) return;
    const movement = (getSvgX(event) - drag.current.x) / drag.current.scale;
    const rawSpacing = drag.current.spacing + movement * (getSvgX(event) >= W / 2 ? 2 : -2);
    const snapped = Math.round(Math.max(1, rawSpacing) / 1) * 1;
    onChange('holeSpacing', snapped);
  };
  const stop = () => { drag.current = null; };

  return (
    <svg className="sketch-svg" viewBox={`0 0 ${W} ${H}`} ref={svg} role="img" aria-label="2D plate profile and two hole centres, with draggable hole centres">
      <defs>
        <pattern id="sketch-grid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#23384b" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#sketch-grid)" />
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#8e4754" strokeDasharray="8 6" opacity=".7" />
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#3f8b70" strokeDasharray="8 6" opacity=".7" />
      <rect x={left} y={top} width={width * scale} height={depth * scale} fill="#1a778c" fillOpacity=".14" stroke="#78d9e8" strokeWidth="3" onClick={() => onSelect('sketch-plate')} />
      {[-span, span].map((offset, i) => (
        <circle key={i} cx={W / 2 + offset} cy={H / 2} r={radius}
          stroke="#ffd48b" fill="#102332" fillOpacity=".85" strokeWidth="3"
          onPointerDown={begin} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}
          style={{ cursor: 'ew-resize', touchAction: 'none' }} />
      ))}
      <line x1={left} x2={left + width * scale} y1={top - 36} y2={top - 36} stroke="#a9d9ed" strokeWidth="1.8" />
      <line x1={left} x2={left} y1={top - 47} y2={top - 23} stroke="#a9d9ed" />
      <line x1={left + width * scale} x2={left + width * scale} y1={top - 47} y2={top - 23} stroke="#a9d9ed" />
      <rect x={W / 2 - 43} y={top - 51} width={86} height={26} rx="5" fill="#152536" />
      <text x={W / 2} y={top - 32} textAnchor="middle" fill="#bce7fa" fontSize="20" fontFamily="monospace">{width} mm</text>
      <line x1={left - 39} x2={left - 39} y1={top} y2={top + depth * scale} stroke="#a9d9ed" />
      <text x={left - 51} y={H / 2} textAnchor="middle" fill="#bce7fa" fontSize="20" transform={`rotate(-90 ${left - 51} ${H / 2})`}>{depth} mm</text>
      <line x1={W / 2 - span} x2={W / 2 + span} y1={H / 2 + radius + 40} y2={H / 2 + radius + 40} stroke="#ffd48b" />
      <text x={W / 2} y={H / 2 + radius + 66} textAnchor="middle" fill="#ffd48b" fontSize="18">PITCH {holeSpacing} mm</text>
      <text x={W / 2} y={H - 18} textAnchor="middle" fill="#698598" fontSize="16">SKETCH PREVIEW · DRAG A HOLE CENTRE TO EDIT PITCH</text>
    </svg>
  );
}
