/**
 * Final synchronous publication fence for source-matched STEP downloads.
 * The HTTP client checks the archive during evaluation; the UI checks again
 * at the exact moment it hands verified bytes to the browser download API.
 */
export interface RevisionSource { readonly projectId:string; readonly revision:number }
export function verifyCurrentStepRevision<T extends {document:{projectId:string;revision:number}}>({
  originalArchive,readCurrentHistory,serialize,source,
}:Readonly<{
  originalArchive:string;
  readCurrentHistory:()=>T;
  serialize:(history:T)=>string;
  source:RevisionSource;
}>):boolean {
  try {
    const current=readCurrentHistory();
    return current.document.projectId===source.projectId &&
      current.document.revision===source.revision &&
      serialize(current)===originalArchive;
  }catch{return false;}
}

/** Browser filename, NOT a user-controlled native filesystem path. */
export function experimentalStepFilename(projectId:string,revision:number):string {
  if(typeof projectId!=='string' || !Number.isSafeInteger(revision) || revision<0)
    throw new TypeError('Invalid STEP filename identity');
  const safe=projectId.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,64)||'plate';
  return safe+'-revision-'+revision+'-experimental.step';
}

/** A STEP filename may state its backend only when it came from a verified
 * currentStepReceipt(), never from a configured URL or a guessed provider. */
export function sourceBoundStepFilename(
  projectId:string,revision:number,backend:'OCCT-cxx-8.0.1'|'OCP-python-prototype',
):string {
  if(backend!=='OCCT-cxx-8.0.1'&&backend!=='OCP-python-prototype')
    throw new TypeError('Unrecognized source-bound STEP backend');
  const experimental=experimentalStepFilename(projectId,revision);
  return backend==='OCCT-cxx-8.0.1'
    ?experimental.replace(/-experimental\.step$/,'-pinned-occt8-cxx.step')
    :experimental;
}
