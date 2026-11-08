/**
 * Browser-only typed control validation. Admission, hole identity and
 * geometry remain exclusively with the accepted RUNTIME/SKETCH APIs.
 */
export type SolidHoleField = 'x' | 'y' | 'diameter';
export function parseSolidHoleNumber(source:string,field:SolidHoleField):number {
  if(typeof source!=='string'||source.trim()==='')
    throw Error('Enter a numeric '+field+' in millimetres.');
  const value=Number(source);
  if(!Number.isFinite(value)||Math.abs(value)>10000 ||
      (field==='diameter'&&value<=0))
    throw Error(field==='diameter'
      ?'Bore diameter must be finite and greater than zero, up to 10,000 mm.'
      :'Hole centre must be finite and within ±10,000 mm.');
  return value;
}
