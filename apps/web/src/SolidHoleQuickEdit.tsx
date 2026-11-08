import { useState } from 'react';
import type { ModelHoleDimensions } from './runtimeSession';
import { parseSolidHoleNumber } from './solidHoleNumeric';

/**
 * Contextual, source-owned 3D hole edit. It never edits a mesh or derives a
 * permanent coordinate from a raycast: selection supplies a semantic hole ID
 * and every commit delegates to revision-fenced RUNTIME/SKETCH operations.
 */
export function SolidHoleQuickEdit({holeId,hole,editable,disabled,onMove,onDiameter}:{
  holeId:string;
  hole:ModelHoleDimensions;
  editable:boolean;
  disabled:boolean;
  onMove:(x:number,y:number)=>boolean;
  onDiameter:(diameter:number)=>boolean;
}) {
  const [x,setX]=useState(String(hole.x));
  const [y,setY]=useState(String(hole.y));
  const [diameter,setDiameter]=useState(String(hole.diameter));
  const [error,setError]=useState<string|null>(null);
  const reset=()=>{
    setX(String(hole.x));setY(String(hole.y));
    setDiameter(String(hole.diameter));setError(null);
  };
  const move=()=>{
    try {
      const nextX=parseSolidHoleNumber(x,'x');
      const nextY=parseSolidHoleNumber(y,'y');
      if(nextX===hole.x&&nextY===hole.y){setError(null);return;}
      if(!onMove(nextX,nextY)){
        setError('SKETCH refused this centre. The current model is unchanged; see the workbench status.');
        return;
      }
      setError(null);
    } catch (cause) {setError(cause instanceof Error?cause.message:String(cause));}
  };
  const resize=()=>{
    try {
      const next=parseSolidHoleNumber(diameter,'diameter');
      if(next===hole.diameter){setError(null);return;}
      if(!onDiameter(next)){
        setError('SKETCH refused this bore. The current model is unchanged; see the workbench status.');
        return;
      }
      setError(null);
    } catch (cause) {setError(cause instanceof Error?cause.message:String(cause));}
  };
  return <section className="runtime-solid-quickedit"
      data-testid="runtime-solid-quickedit" aria-label={'Edit selected solid hole '+holeId}>
    <strong>Selected bore · {holeId}</strong>
    {!editable?<p>Edge-relative hole: edit along/inset/radius in the solver-owned selected-edge inspector. A Cartesian centre is not available.</p>:
    <>
      <div className="runtime-solid-quickedit-fields">
        <label>X centre · mm
          <input type="number" step="any" data-testid="runtime-solid-quickedit-x"
            aria-label="Selected solid hole X centre in millimetres" value={x}
            disabled={disabled} onChange={event=>setX(event.target.value)}
            onKeyDown={event=>{
              if(event.key==='Enter'){event.preventDefault();move();}
              if(event.key==='Escape'){event.preventDefault();reset();}
            }}/>
        </label>
        <label>Y centre · mm
          <input type="number" step="any" data-testid="runtime-solid-quickedit-y"
            aria-label="Selected solid hole Y centre in millimetres" value={y}
            disabled={disabled} onChange={event=>setY(event.target.value)}
            onKeyDown={event=>{
              if(event.key==='Enter'){event.preventDefault();move();}
              if(event.key==='Escape'){event.preventDefault();reset();}
            }}/>
        </label>
      </div>
      <button type="button" data-testid="runtime-solid-quickedit-move"
        disabled={disabled} onClick={move}>Move centre · one undo step</button>
      <div className="runtime-solid-quickedit-bore">
        <label>Bore Ø · mm
          <input type="number" step="any" min="0.001"
            data-testid="runtime-solid-quickedit-diameter"
            aria-label="Selected solid hole bore diameter in millimetres" value={diameter}
            disabled={disabled} onChange={event=>setDiameter(event.target.value)}
            onKeyDown={event=>{
              if(event.key==='Enter'){event.preventDefault();resize();}
              if(event.key==='Escape'){event.preventDefault();reset();}
            }}/>
        </label>
        <button type="button" data-testid="runtime-solid-quickedit-resize"
          disabled={disabled} onClick={resize}>Apply Ø</button>
      </div>
      {error&&<p role="alert" data-testid="runtime-solid-quickedit-error">{error}</p>}
      <small>Solver-admitted model edit; STEP becomes stale. Escape resets a draft. Undo restores the original semantic hole.</small>
    </>}
  </section>;
}
