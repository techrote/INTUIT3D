import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkbenchEntry } from './WorkbenchEntry';

const target = document.getElementById('root');
if (!target) throw new Error('Workbench root element missing');
createRoot(target).render(<StrictMode><WorkbenchEntry /></StrictMode>);
