/** Type-only browser consumer of the real public RUNTIME/INTENT package boundary. */
import type {UndoHistory} from '@intuit3d/model/transactions';
import type {WorkflowRuntime} from '../index.mjs';
import {createLivePlateSession,type LivePlateSessionState} from '../live-plate-session.mjs';
import type {VerifiedLocalStep,LocalPlateClientResult} from '../local-plate-client.mjs';

declare const runtime:WorkflowRuntime;
declare let current:UndoHistory;
const session=createLivePlateSession({runtime,readCurrentHistory:()=>current,
  publishHistory:history=>{current=history;},cutFeatureId:'cut'});

const state:LivePlateSessionState=session.refresh();
const currentRevision:number=state.revision;
const authority:false=state.exactAuthority;
const archive:string=session.save();
const restored=session.reopen(archive);
if(restored.kind==='opened') {
  const exactReuseAllowed:false=restored.exactReuseAllowed;
  void exactReuseAllowed;
}
const edit=session.applyEdit(h=>runtime.editPlateHoles(h,{
  sketchFeatureId:'sketch.plate',eventId:'session.contract.add.hole',
  expectedRevision:h.document.revision,admission:'require_admissible',
  operations:[{kind:'add',id:'holeC',x:60,y:20,radius:4}],
}));
if(edit.kind==='committed') {
  const invalidated:readonly string[]=edit.invalidation.invalidatedFeatureIds;
  const next:UndoHistory=edit.history;
  void [invalidated,next];
}
async function browserDownload() {
  const result:LocalPlateClientResult=await session.evaluate({
    url:'http://127.0.0.1:3000',token:'0'.repeat(64),exportStep:true,
  });
  const step:VerifiedLocalStep|null=session.currentStep();
  if(result.kind==='experimental_plate_evaluated'&&step) {
    const bytes:Uint8Array=step.bytes;
    const verified:string=step.sha256;
    void [bytes,verified];
  }
  session.cancel();
  return result;
}
void [currentRevision,authority,browserDownload];
