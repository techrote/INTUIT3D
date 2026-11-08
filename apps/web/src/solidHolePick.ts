/** Maps a top-facing preview click to an existing solver-authored hole ID.
 * The returned ID is for selection only; never geometry, topology, or STEP authority. */
export interface SolvedHoleMarker { id:string; x:number; y:number; radius:number }
export function pickTopFaceHole(
  point:{x:number;y:number}, holes:readonly SolvedHoleMarker[],
):string|null {
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
  let candidate:{id:string;normalizedDistance:number}|null=null;
  for(const hole of holes){
    if(!hole.id||![hole.x,hole.y,hole.radius].every(Number.isFinite)||
       hole.radius<=0)continue;
    const dx=point.x-hole.x,dy=point.y-hole.y;
    const normalizedDistance=(dx*dx+dy*dy)/(hole.radius*hole.radius);
    if(normalizedDistance<=1 &&
       (!candidate||normalizedDistance<candidate.normalizedDistance))
      candidate={id:hole.id,normalizedDistance};
  }
  return candidate?.id??null;
}
