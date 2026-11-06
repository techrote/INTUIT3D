import {plateSketchFixture} from '../index.mjs';
import {suggestSketchSnaps,SKETCH_SNAP_VERSION,type SnapResponse,type SnapOptions,type SnapCandidate} from '../snap.mjs';
const opts:SnapOptions={radiusMm:1,gridMm:0.5,excludeIds:['p0']};
const result:SnapResponse=suggestSketchSnaps(plateSketchFixture(),{x:120,y:0},opts);
const version:1=SKETCH_SNAP_VERSION;
if(result.status==='ready'){
  const chosen:SnapCandidate=result.selected!;
  const kind:SnapCandidate['kind']=chosen.kind;
  void kind;
}
// @ts-expect-error only supported snap kinds may be persisted at typed consumers
const bogus:SnapCandidate['kind']='face';
void bogus;
// @ts-expect-error preview-only response is not authoritative intent
const authoritative:false=result.previewOnly;
void authoritative;void version;
