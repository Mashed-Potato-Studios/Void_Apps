import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminDashboard, { loader } from '../pages/index.js';

function showFatal(error: unknown): void {
  const root = document.getElementById('root');
  if (!root) return;
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#ef4444;padding:2rem;font-family:monospace';
  pre.textContent = `Failed to load admin dashboard: ${error instanceof Error ? error.message : String(error)}`;
  root.replaceChildren(pre);
}

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  const initial = await loader().catch(() => ({}));
  createRoot(root).render(
    <StrictMode>
      <AdminDashboard {...initial} />
    </StrictMode>,
  );
}

start().catch(showFatal);

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => showFatal(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => showFatal(event.reason));
}
