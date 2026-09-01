import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { useStore } from './state/store';
import './index.css';

// Development affordance: inspect and drive the store from the console.
if (import.meta.env.DEV) {
  (window as unknown as { store: typeof useStore }).store = useStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
