import { useState } from 'react';
import App from './App';
import { RuntimeWorkbench } from './RuntimeWorkbench';

/** Mount exactly one document authority. The legacy preview is opt-in only. */
export function WorkbenchEntry() {
  const [mode, setMode] = useState<'model' | 'preview'>(() =>
    new URLSearchParams(window.location.search).get('mode') === 'preview' ? 'preview' : 'model');
  const open = (next: 'model' | 'preview') => {
    const url = new URL(window.location.href);
    if (next === 'preview') url.searchParams.set('mode', 'preview');
    else url.searchParams.delete('mode');
    window.history.replaceState(window.history.state, '', url);
    setMode(next);
  };
  return mode === 'model'
    ? <RuntimeWorkbench onClose={() => open('preview')} />
    : <App onEnterModel={() => open('model')} />;
}
