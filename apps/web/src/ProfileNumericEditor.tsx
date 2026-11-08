import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PointerEditableHandle } from '@intuit3d/sketch/pointer-profile-edit/v1';
import { numericProfileHandleTarget } from './profileNumericTarget';

export function ProfileNumericEditor({ handle, disabled, onCommit }: {
  handle: PointerEditableHandle;
  disabled: boolean;
  onCommit: (target: { x: number; y: number }) => void;
}) {
  // Parent keys this editor to the authoritative document revision and
  // explicit handle ID: drafts cannot silently carry across selection changes.
  const [value, setValue] = useState(String(handle.valueMm ?? ''));
  const [x, setX] = useState(String(handle.position.x));
  const [y, setY] = useState(String(handle.position.y));
  const [error, setError] = useState<string | null>(null);
  const commit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    try {
      const target = numericProfileHandleTarget(handle, { value, x, y });
      setError(null);
      onCommit(target);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return <form className="runtime-hole-add" onSubmit={commit}
      data-testid="runtime-profile-numeric-editor">
    <strong>Precise semantic edit · {handle.handleId}</strong>
    {handle.kind === 'dimension' ? <label className="runtime-scalar">
      <span>{handle.dimensionKind === 'radius' ? 'Radius' :
        handle.dimensionKind === 'distanceX' ? 'Signed X distance' : 'Signed Y distance'} · mm</span>
      <span className="runtime-scalar-control">
        <input type="number" step="any" aria-label="Selected profile dimension in millimetres"
          data-testid="runtime-profile-numeric-value"
          value={value} disabled={disabled}
          onChange={event => setValue(event.target.value)}/>
      </span>
    </label> : <>
      <label className="runtime-scalar"><span>Centre X · mm</span>
        <span className="runtime-scalar-control">
          <input type="number" step="any" aria-label="Selected profile hole centre X"
            data-testid="runtime-profile-numeric-x"
            value={x} disabled={disabled} onChange={event => setX(event.target.value)}/>
        </span>
      </label>
      <label className="runtime-scalar"><span>Centre Y · mm</span>
        <span className="runtime-scalar-control">
          <input type="number" step="any" aria-label="Selected profile hole centre Y"
            data-testid="runtime-profile-numeric-y"
            value={y} disabled={disabled} onChange={event => setY(event.target.value)}/>
        </span>
      </label>
    </>}
    <button type="submit" className="ribbon-button" disabled={disabled}
      data-testid="runtime-profile-numeric-commit">Apply to selected contour</button>
    {error && <small role="alert" data-testid="runtime-profile-numeric-error">{error}</small>}
    <p className="microcopy">Uses the current selected contour's real SKETCH
      constraint and the existing revision-fenced RUNTIME transaction.
      Admissibility, dependencies and undo are checked before commitment.
      Preview is analytic; native STEP is revoked on an accepted edit.</p>
  </form>;
}
