import {assessCircularProfile,CIRCLE_GUARD_VERSION} from '../circle-guard.mjs';
import type {CircularGuardCircle,CircularGuardPoint,CircularProfileAssessment} from '../circle-guard.mjs';
const version:1=CIRCLE_GUARD_VERSION;
const corners:ReadonlyArray<CircularGuardPoint>=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
const holes:ReadonlyArray<CircularGuardCircle>=[{id:'hole',x:5,y:5,radius:1}];
const answer:CircularProfileAssessment=assessCircularProfile(corners,holes);
const status:'verified'|'rejected'=answer.status;
void [version,status,answer.insideIds,answer.outsideIds];
