import {useState} from 'react';
import type {FormEvent} from 'react';
import type {ClosedContourHandle} from '@intuit3d/sketch/closed-contour-authoring/v1';

/** Ephemeral numeric coordinates for one explicitly chosen solver-owned vertex.
 * The parent keys this form by source revision, archive and semantic handle.
 * RUNTIME still owns all admission, revision changes and undo history.
 */
export function ClosedContourVertexEditor({handle,disabled,onCommit}:{
  handle:ClosedContourHandle;disabled:boolean;
  onCommit:(position:{x:number;y:number})=>void;
}) {
  const [x,setX]=useState(String(handle.position.x));
  const [y,setY]=useState(String(handle.position.y));
  const [error,setError]=useState<string|null>(null);
  const commit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(disabled)return;
    const nx=Number(x),ny=Number(y);
    if(!x.trim()||!y.trim()||!Number.isFinite(nx)||!Number.isFinite(ny)||
       Math.abs(nx)>10000||Math.abs(ny)>10000){
      setError('Enter finite X and Y coordinates within ±10,000 mm.');return;
    }
    if(nx===handle.position.x&&ny===handle.position.y){
      setError('No vertex movement requested.');return;
    }
    setError(null);
    onCommit({x:nx,y:ny});
  };
  return <form className="runtime-hole-add" onSubmit={commit}
    data-testid="runtime-drawn-contour-vertex-editor">
    <strong>{handle.kind==='origin'?'Origin':'Vertex '+handle.index} · {handle.handleId}</strong>
    <label className="runtime-scalar"><span>Vertex X · mm</span>
      <span className="runtime-scalar-control"><input type="number" step="any"
        data-testid="runtime-drawn-vertex-x" aria-label="Selected drawn vertex X in millimetres"
        value={x} disabled={disabled} onChange={e=>setX(e.target.value)}/></span>
    </label>
    <label className="runtime-scalar"><span>Vertex Y · mm</span>
      <span className="runtime-scalar-control"><input type="number" step="any"
        data-testid="runtime-drawn-vertex-y" aria-label="Selected drawn vertex Y in millimetres"
        value={y} disabled={disabled} onChange={e=>setY(e.target.value)}/></span>
    </label>
    <button type="submit" className="ribbon-button"
      data-testid="runtime-drawn-vertex-commit" disabled={disabled}>Move selected vertex</button>
    {error&&<small role="alert">{error}</small>}
    <p className="microcopy">Selected coordinates are exact sketch-local millimetres.
      Drag the amber marker in Sketch XY or enter both coordinates. SKETCH checks
      the complete contour and associated holes before RUNTIME commits one undoable
      source-fenced edit. Native STEP becomes stale.</p>
  </form>;
}
