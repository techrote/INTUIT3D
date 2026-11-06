import {assessAnalyticProfileArea,ANALYTIC_AREA_GUARD_VERSION} from '@intuit3d/sketch/analytic-area/v1';
const version:1=ANALYTIC_AREA_GUARD_VERSION;
const result=assessAnalyticProfileArea([{x:0,y:0},{x:5,y:0},{x:0,y:5}]);
if(result.status==='verified'){
  const area:number=result.areaMm2;
  void area;
}else{
  const reason:string=result.reason;
  const absent:null=result.areaMm2;
  void reason;void absent;
}
void version;
