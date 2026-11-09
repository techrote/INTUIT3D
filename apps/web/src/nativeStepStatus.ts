/**
 * Browser-facing summary of the authoritative RUNTIME native-provider state.
 * A source-bound, same-engine-verified STEP is NOT an independent CAD proof.
 * Never infer the backend from a configured URL or a previous successful run.
 */
import type {LivePlateSessionState} from '@intuit3d/workflow-runtime/live-plate-session';

export type NativeReceiptBackend='OCCT-cxx-8.0.1'|'OCP-python-prototype';
export type NativeIndicator=Readonly<{
  phase:'not_ready'|'unavailable'|'pending'|'blocked'|'failed'|'cancelled'|
    'current_pinned'|'current_experimental'|'last_good_pinned'|'last_good_experimental';
  label:string;
  detail:string;
}>;

type NativeSnapshot=Pick<LivePlateSessionState,
  'revision'|'providerState'|'stepAvailability'|'lastResultCode'>;

/** The backend must come from currentStepReceipt(), not a stale React flag. */
export function describeNativeStep(
  snapshot:NativeSnapshot,receiptBackend:NativeReceiptBackend|null,canEvaluate:boolean,
):NativeIndicator {
  const receiptCurrent=snapshot.stepAvailability==='current'&&receiptBackend!==null;
  const retained=snapshot.stepAvailability==='last_good'&&receiptBackend!==null;
  const pinned=receiptBackend==='OCCT-cxx-8.0.1';
  const retainedDescription=retained
    ? ` A source-matched ${pinned?'pinned OCCT8 C++':'experimental OCP'} STEP remains available as LAST GOOD, not the result of this attempt.`
    : '';
  const code=snapshot.lastResultCode?` (${snapshot.lastResultCode})`:'';
  if(snapshot.providerState==='pending')
    return {phase:'pending',label:'NATIVE PENDING',
      detail:`Revision ${snapshot.revision}: native request in flight; no new STEP is ready.`+retainedDescription};
  if(snapshot.providerState==='provider_failed')
    return {phase:'failed',label:'NATIVE PROVIDER FAILED',
      detail:`Revision ${snapshot.revision}: latest provider attempt failed${code}.`+retainedDescription};
  if(snapshot.providerState==='blocked')
    return {phase:'blocked',label:'NATIVE BLOCKED',
      detail:`Revision ${snapshot.revision}: source/provider admission refused${code}. No new STEP was published.`+retainedDescription};
  if(snapshot.providerState==='cancelled')
    return {phase:'cancelled',label:'NATIVE CANCELLED',
      detail:`Revision ${snapshot.revision}: latest evaluation cancelled; no new STEP was published.`+retainedDescription};
  if(retained)
    return {phase:pinned?'last_good_pinned':'last_good_experimental',
      label:pinned?'PINNED C++ STEP · LAST GOOD':'OCP STEP · LAST GOOD',
      detail:`Revision ${snapshot.revision}: retained source-matched STEP; latest attempt was not a successful replacement. No independent CAD readback is asserted.`};
  if(receiptCurrent)
    return {phase:pinned?'current_pinned':'current_experimental',
      label:pinned?'PINNED C++ STEP · CURRENT':'OCP STEP · CURRENT',
      detail:`Revision ${snapshot.revision}: source-bound ${pinned?'OCCT8 C++':'experimental OCP'} STEP is available. Browser custody and same-engine verification do not establish independently validated geometry.`};
  // A state that claims bytes but provides no admissible source-bound receipt
  // must not advertise success (including equal-revision divergent archives).
  if(!canEvaluate)
    return {phase:'not_ready',label:'NATIVE NOT READY',
      detail:`Revision ${snapshot.revision}: author an admitted extrusion and targeted cut before building physical STEP.`};
  return {phase:'unavailable',label:'NATIVE STEP UNAVAILABLE',
    detail:`Revision ${snapshot.revision}: no current source-matched STEP receipt. Rebuild with the intended local provider.`};
}
