/** Camera-only bounding sphere. Uses actual admitted profile bounds; never CAD authority. */
export type CameraViewPreset='isometric'|'top'|'front'|'right';
export interface PreviewFrameBounds {minX:number;maxX:number;minY:number;maxY:number;thickness:number;}
export function frameCadCamera(box:PreviewFrameBounds,aspect:number,preset:CameraViewPreset) {
  if(![box.minX,box.maxX,box.minY,box.maxY,box.thickness,aspect].every(Number.isFinite)||
    box.maxX<=box.minX||box.maxY<=box.minY||box.thickness<=0||aspect<=0||
    !['isometric','top','front','right'].includes(preset))
    throw Error('Cannot frame an invalid or unsupported 3D preview.');
  const center={x:(box.minX+box.maxX)/2,y:(box.minY+box.maxY)/2,z:box.thickness/2};
  const halfFov=40*Math.PI/360;
  const halfHorizontal=Math.atan(Math.tan(halfFov)*aspect);
  const radius=Math.hypot(box.maxX-box.minX,box.maxY-box.minY,box.thickness)/2;
  const distance=Math.max(1,radius*1.25/Math.sin(Math.min(halfFov,halfHorizontal)));
  const direction=preset==='top'?{x:0,y:0,z:1}:
    preset==='front'?{x:0,y:-1,z:0}:preset==='right'?{x:1,y:0,z:0}:
    {x:1.6,y:-1.45,z:1.55};
  const length=Math.hypot(direction.x,direction.y,direction.z);
  const offset={x:direction.x/length,y:direction.y/length,z:direction.z/length};
  const up=preset==='top'?{x:0,y:1,z:0}:{x:0,y:0,z:1};
  return {center,offset,up,distance};
}
