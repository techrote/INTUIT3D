import {useEffect,useMemo,useState} from 'react';
import type {ModelSession} from './runtimeSession';
import {commitModelEdgeHole,inspectModelEdgeHoles,removeModelEdgeHole} from './selectedEdgeHole';

/** Explicit, source-fenced EDGE-local dimensions; never a duplicate sketch or
 * inferred native body. Invalid proposals remain transient, with the original
 * journal and STEP authority unchanged. */
export function SelectedEdgeHoleEditor({history,disabled,onAccept,onMessage}:{
  history:ModelSession;disabled:boolean;
  onAccept:(next:ModelSession,holeId:string)=>void;
  onMessage:(message:string)=>void;
}) {
  const inspection=useMemo(()=>{
    try{return {review:inspectModelEdgeHoles(history),error:null};}
    catch(error){return {review:null,error:String(error)};}
  },[history]);
  const ready=inspection.review?.kind==='ready'?inspection.review:null;
  const edges=ready?.inspection.edges.filter(edge=>edge.editable)??[];
  const existing=ready?.inspection.holes.filter(hole=>hole.canEdit)??[];
  const [holeChoice,setHoleChoice]=useState('__new__');
  const [edgeChoice,setEdgeChoice]=useState('');
  const [draft,setDraft]=useState({alongMm:'',insetMm:'',radiusMm:''});
  const [feedback,setFeedback]=useState<string|null>(null);
  useEffect(()=>{
    // An external edit, undo or file replacement revokes the previous source
    // signature. Never silently submit dimensions from that prior revision.
    setHoleChoice('__new__');setEdgeChoice('');
    setDraft({alongMm:'',insetMm:'',radiusMm:''});setFeedback(null);
  },[history.document.projectId,history.document.revision]);
  const choice=existing.some(h=>h.holeId===holeChoice)?holeChoice:'__new__';
  const edge=edges.find(item=>item.edgeId===edgeChoice)??edges[0];
  const selectHole=(id:string)=>{
    setHoleChoice(id);setFeedback(null);
    const h=existing.find(item=>item.holeId===id);
    setEdgeChoice(h?.edgeBinding?.edgeId??'');
    setDraft(h?{
      alongMm:h.edgeBinding?String(h.edgeBinding.alongMm):'',
      insetMm:h.edgeBinding?String(h.edgeBinding.insetMm):'',
      radiusMm:String(h.radiusMm),
    }:{alongMm:'',insetMm:'',radiusMm:''});
  };
  const notify=(message:string)=>{setFeedback(message);onMessage(message);};
  const commit=()=>{
    if(!ready||!edge)return;
    if(Object.values(draft).some(v=>v.trim()==='')){
      notify('Enter along-edge distance, inward inset and bore radius before committing.');return;
    }
    const id=choice==='__new__'?'hole.edge.'+crypto.randomUUID().replaceAll('-',''):choice;
    try{
      const result=commitModelEdgeHole(history,ready,{
        holeId:id,edgeId:edge.edgeId,alongMm:Number(draft.alongMm),
        insetMm:Number(draft.insetMm),radiusMm:Number(draft.radiusMm),
      });
      if(result.kind==='refused'){
        notify('Selected-edge operation refused: '+result.reason+'; original model unchanged.');return;
      }
      onAccept(result.history,id);
      notify(`Revision ${result.history.document.revision}: ${result.createdHoleIds.includes(id)?'created':'reanchored'} ${id} relative to ${edge.edgeId}. Undo/reopen preserve the dimensions; previous STEP revoked.`);
    }catch(error){notify('Selected-edge edit refused: '+String(error));}
  };
  const remove=()=>{
    if(choice==='__new__')return;
    try{
      const result=removeModelEdgeHole(history,choice);
      if(result.kind==='refused'){
        notify('Selected-hole removal refused: '+result.reason);return;
      }
      const id=choice;
      onAccept(result.history,id);
      notify(`Revision ${result.history.document.revision}: removed ${id} with dependency checks. Undo restores the semantic hole.`);
    }catch(error){notify('Selected-hole removal refused: '+String(error));}
  };
  return <div className="runtime-hole-add" data-testid="runtime-edge-hole-editor">
    <strong>Selected-contour edge-relative holes · solver-owned</strong>
    <p className="microcopy">Choose an actual constrained boundary edge, measure a signed distance
      along its oriented start vertex and a positive inward inset, then create a persistent hole
      or adjust an existing edge-anchored hole. The three dimensions are real SKETCH constraints,
      not saved canvas coordinates. Native STEP remains pending a separate source-matched build.</p>
    {!ready?<p className="microcopy" role="status" data-testid="runtime-edge-hole-unavailable">
      {inspection.error??inspection.review?.kind==='refused'&&inspection.review.reason||
       'No uniquely admitted selected contour; resolve or select a profile before edge authoring.'}
    </p>:<>
      <p className="microcopy" data-testid="runtime-edge-hole-profile">
        Selected solved contour: {ready.inspection.semanticProfileId} · revision {ready.sourceRevision} · analytic preview only
      </p>
      <label className="runtime-scalar"><span>Boundary edge</span>
        <span className="runtime-scalar-control">
          <select aria-label="Selected boundary edge" data-testid="runtime-edge-hole-edge"
            value={edge?.edgeId??''} disabled={disabled||!edges.length}
            onChange={event=>{
              setEdgeChoice(event.target.value);
              setDraft(previous=>({...previous,alongMm:'',insetMm:''}));
            }}>
            {edges.map(item=><option key={item.edgeId} value={item.edgeId}>
              {item.edgeId} · ({item.start.x}, {item.start.y}) → ({item.end.x}, {item.end.y}) · {item.lengthMm.toFixed(2)} mm
            </option>)}
          </select>
        </span>
      </label>
      <label className="runtime-scalar"><span>Target</span>
        <span className="runtime-scalar-control">
          <select aria-label="Edge hole target" data-testid="runtime-edge-hole-target"
            value={choice} disabled={disabled} onChange={e=>selectHole(e.target.value)}>
            <option value="__new__">New semantic circular hole</option>
            {existing.map(hole=><option value={hole.holeId} key={hole.holeId}>
              {hole.holeId}{hole.edgeBinding?' · bound to '+hole.edgeBinding.edgeId:' · choose new anchor'}
            </option>)}
          </select>
        </span>
      </label>
      {(['alongMm','insetMm','radiusMm'] as const).map(field=><label className="runtime-scalar" key={field}>
        <span>{field==='alongMm'?'Along oriented edge':field==='insetMm'?'Inward inset':'Hole radius'}</span>
        <span className="runtime-scalar-control">
          <input type="number" step="any" aria-label={field}
            data-testid={'runtime-edge-hole-'+field} disabled={disabled}
            value={draft[field]}
            onChange={event=>setDraft(previous=>({...previous,[field]:event.target.value}))}/>
          <small>mm</small>
        </span>
      </label>)}
      <button type="button" className="ribbon-button runtime-native-export"
        data-testid="runtime-edge-hole-commit" disabled={disabled||!edge}
        onClick={commit}>{choice==='__new__'?'Create anchored hole':'Apply edge-relative dimensions'}</button>
      {choice!=='__new__'&&<button type="button" className="ribbon-button"
        data-testid="runtime-edge-hole-remove" disabled={disabled} onClick={remove}>
        Remove anchored hole
      </button>}
      {!edges.length&&<p className="microcopy">No orthogonal solver-constrained edges are currently editable.</p>}
    </>}
    {feedback&&<p role="status" data-testid="runtime-edge-hole-feedback">{feedback}</p>}
  </div>;
}
