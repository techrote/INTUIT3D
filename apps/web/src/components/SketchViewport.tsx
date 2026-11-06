import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { geometryIsAdmissible, type Document, type DimensionKey } from '../model';
import { inferPreviewSketchCursor, formatPreviewCursorMm, type PreviewSketchCursor } from '../sketchCursor';
import { projectClientToSketchSvg } from '../sketchProjection';
import { nudgeHolePitch, proposeHolePitch, type HolePitchDrag, type HoleSide } from '../sketchInteraction';
import { nudgeOutlineDimension, outlineAxis, proposeOutlineDimension, type OutlineDimensionDrag, type OutlineKey } from '../outlineDimension';

interface Props {
  document: Document;
  onChange: (key: DimensionKey, value: number) => void;
  onSelect: (id: string) => void;
  onGestureStart: (key: DimensionKey) => void;
  onGesturePreview: (value: number) => void;
  onGestureFinish: () => void;
  onGestureCancel: () => void;
  canEdit: boolean;
}
const W = 1000;
const H = 650;

type DragState = HolePitchDrag & { readonly pointerId: number };
type OutlineDragState = OutlineDimensionDrag & { readonly pointerId: number };

/** Scaled 2D sketch-intent visualization, not a constraint solver. */
export function SketchViewport({ document, onChange, onSelect, onGestureStart, onGesturePreview, onGestureFinish, onGestureCancel, canEdit }: Props) {
  const { width, depth, holeDiameter, holeSpacing } = document.params;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const outlineDrag = useRef<OutlineDragState | null>(null);
  const [cursor, setCursor] = useState<PreviewSketchCursor | null>(null);
  const scale = Math.min(4.6, 660 / Math.max(1, width), 410 / Math.max(1, depth));
  const left = W / 2 - width * scale / 2;
  const top = H / 2 - depth * scale / 2;
  const radius = holeDiameter * scale / 2;
  const span = holeSpacing * scale / 2;

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (drag.current || outlineDrag.current)) {
        drag.current = null;
        outlineDrag.current = null;
        setCursor(null);
        onGestureCancel();
      }
    };
    // A hidden/blurred page must not leave a provisional document gesture live.
    const abandon = () => {
      if (drag.current || outlineDrag.current) {
        drag.current = null;
        outlineDrag.current = null;
        setCursor(null);
        onGestureCancel();
      }
    };
    const onVisibility = () => { if (globalThis.document.hidden) abandon(); };
    window.addEventListener('keydown', onEscape);
    window.addEventListener('blur', abandon);
    globalThis.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('blur', abandon);
      globalThis.document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onGestureCancel]);

  // Missing, singular or non-finite DOM transforms must never be treated as
  // the sketch origin; fail closed before beginning or continuing an edit.
  const getSvgPoint = (event: ReactPointerEvent<SVGElement>) => {
    const element = svg.current;
    if (!element) return null;
    try {
      return projectClientToSketchSvg(event.clientX, event.clientY, element.getScreenCTM());
    } catch {
      return null;
    }
  };
  const updateCursor = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current || outlineDrag.current) return;
    try {
      const point = getSvgPoint(event);
      if (!point) { setCursor(null); return; }
      setCursor(inferPreviewSketchCursor({
        centreX: W / 2, centreY: H / 2, pixelsPerMm: scale,
        widthMm: width, depthMm: depth, holePitchMm: holeSpacing,
      }, point.x, point.y, { allowProfileSnaps: geometryIsAdmissible(document) }));
    } catch {
      // Noninvertible SVG transforms and numerical failures are not snap points.
      setCursor(null);
    }
  };
  const begin = (side: HoleSide) => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!canEdit || event.button !== 0 || drag.current || outlineDrag.current) return;
    const point = getSvgPoint(event);
    if (!point) return;
    drag.current = { pointerId: event.pointerId, side, startSvgX: point.x, startPitchMm: holeSpacing, pixelsPerMm: scale };
    setCursor(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    onGestureStart('holeSpacing');
    onSelect('sketch-holes');
  };
  const move = (event: ReactPointerEvent<SVGCircleElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = getSvgPoint(event);
    if (!point) {
      drag.current = null;
      setCursor(null);
      onGestureCancel();
      return;
    }
    onGesturePreview(proposeHolePitch(active, point.x, event.shiftKey ? 0.1 : 1));
  };
  const finish = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    onGestureFinish();
  };
  const cancel = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    onGestureCancel();
  };
  const keyEdit = (side: HoleSide) => (event: ReactKeyboardEvent<SVGCircleElement>) => {
    if (!canEdit || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    onSelect('sketch-holes');
    onChange('holeSpacing', nudgeHolePitch(holeSpacing, side, event.key === 'ArrowLeft' ? 'left' : 'right', event.shiftKey ? 0.1 : 1));
  };

  const beginOutline = (key: OutlineKey) => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!canEdit || event.button !== 0 || drag.current || outlineDrag.current) return;
    const point = getSvgPoint(event);
    if (!point) return;
    outlineDrag.current = {
      key, pointerId: event.pointerId,
      startCoordinate: outlineAxis(key) === 'x' ? point.x : point.y,
      startValueMm: document.params[key], pixelsPerMm: scale,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCursor(null);
    onGestureStart(key);
    onSelect(key === 'holeDiameter' ? 'sketch-holes' : 'sketch-plate');
  };
  const moveOutline = (event: ReactPointerEvent<SVGCircleElement>) => {
    const active = outlineDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = getSvgPoint(event);
    if (!point) {
      outlineDrag.current = null;
      setCursor(null);
      onGestureCancel();
      return;
    }
    onGesturePreview(proposeOutlineDimension(active, outlineAxis(active.key) === 'x' ? point.x : point.y, event.shiftKey ? 0.1 : 1));
  };
  const finishOutline = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!outlineDrag.current || outlineDrag.current.pointerId !== event.pointerId) return;
    outlineDrag.current = null;
    onGestureFinish();
  };
  const cancelOutline = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!outlineDrag.current || outlineDrag.current.pointerId !== event.pointerId) return;
    outlineDrag.current = null;
    onGestureCancel();
  };
  const keyOutline = (key: OutlineKey) => (event: ReactKeyboardEvent<SVGCircleElement>) => {
    if (!canEdit || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const next = nudgeOutlineDimension(document.params[key], key,
      event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', event.shiftKey ? 0.1 : 1);
    if (next === null) return;
    event.preventDefault();
    onSelect(key === 'holeDiameter' ? 'sketch-holes' : 'sketch-plate');
    onChange(key, next);
  };

  return (
    <svg className="sketch-svg" viewBox={`0 0 ${W} ${H}`} ref={svg} role="group" aria-label="2D plate preview, draggable dimensions and visual-only cursor snapping; no constraints automatically authored" data-testid="sketch-viewport" onPointerMove={updateCursor} onPointerLeave={() => setCursor(null)}>
      <defs>
        <pattern id="sketch-grid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#23384b" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#sketch-grid)" />
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#8e4754" strokeDasharray="8 6" opacity=".7" />
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#3f8b70" strokeDasharray="8 6" opacity=".7" />
      <rect x={left} y={top} width={width * scale} height={depth * scale} fill="#1a778c" fillOpacity=".14" stroke="#78d9e8" strokeWidth="3" onClick={() => onSelect('sketch-plate')} />
      {([-span, span] as const).map((offset, i) => {
        const side: HoleSide = i === 0 ? 'left' : 'right';
        return <circle key={side} cx={W / 2 + offset} cy={H / 2} r={radius}
          stroke="#ffd48b" fill="#102332" fillOpacity=".85" strokeWidth="3"
          role="button" tabIndex={canEdit ? 0 : -1} aria-disabled={!canEdit} aria-label={`${side === 'left' ? 'Left' : 'Right'} hole: drag to change pitch, or use arrow keys; Shift for 0.1 mm increments`}
          data-testid={`hole-${side}`} onPointerDown={begin(side)} onPointerMove={move}
          onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
          onKeyDown={keyEdit(side)}
          style={{ cursor: canEdit ? 'ew-resize' : 'not-allowed', touchAction: 'none' }} />;
      })}
      {([
        { key: 'width' as const, x: left + width * scale, y: top, title: 'Plate width: horizontal' },
        { key: 'depth' as const, x: W / 2, y: top + depth * scale, title: 'Plate depth: vertical' },
        { key: 'holeDiameter' as const, x: W / 2 + span + radius, y: H / 2, title: 'Hole diameter: horizontal' },
      ]).map((handle) => (
        <circle key={handle.key} cx={handle.x} cy={handle.y} r={10}
          stroke="#f6edb6" strokeWidth={3} fill="#1e4256" role="button"
          tabIndex={canEdit ? 0 : -1} aria-disabled={!canEdit}
          aria-label={`${handle.title}. Drag the handle, or use arrow keys; Shift for 0.1 mm increments`}
          data-testid={`dimension-handle-${handle.key}`}
          onPointerDown={beginOutline(handle.key)} onPointerMove={moveOutline}
          onPointerUp={finishOutline} onPointerCancel={cancelOutline}
          onLostPointerCapture={cancelOutline} onKeyDown={keyOutline(handle.key)}
          style={{ cursor: canEdit ? (handle.key === 'depth' ? 'ns-resize' : 'ew-resize') : 'not-allowed', touchAction: 'none' }}
        />
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
      {cursor && (
        <g pointerEvents="none" data-testid="sketch-cursor-readout">
          {cursor.snap && (
            <g transform={`translate(${W / 2 + cursor.snap.xMm * scale} ${H / 2 - cursor.snap.yMm * scale})`}>
              <circle r="11" fill="none" stroke="#f5ea91" strokeWidth="2" strokeDasharray="3 2" />
              <path d="M -17 0 H 17 M 0 -17 V 17" stroke="#f5ea91" strokeWidth="1.5" />
            </g>
          )}
          <rect x="14" y="12" width="455" height="59" rx="6" fill="#122635" fillOpacity=".94" stroke="#35586a" />
          <text x="26" y="36" fill="#e4f4fa" fontSize="17" fontFamily="monospace">X {formatPreviewCursorMm(cursor.snap?.xMm ?? cursor.rawXmm)} mm · Y {formatPreviewCursorMm(cursor.snap?.yMm ?? cursor.rawYmm)} mm</text>
          <text x="26" y="59" fill="#f5d98c" fontSize="14" fontFamily="monospace">{cursor.snap ? `VISUAL SNAP: ${cursor.snap.kind} · ${cursor.snap.id}` : 'FREE CURSOR · NO SNAP'} · PREVIEW ONLY</text>
        </g>
      )}
      <text x={W / 2} y={H - 18} textAnchor="middle" fill="#698598" fontSize="16">SKETCH PREVIEW · VISUAL SNAPS DO NOT AUTHOR CONSTRAINTS · SHIFT 0.1 MM · ESC CANCEL</text>
    </svg>
  );
}
