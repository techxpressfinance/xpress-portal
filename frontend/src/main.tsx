import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Number inputs change value on scroll-wheel when focused — a stray scroll
// over an amount, ABN or BSB field silently edits it. Blurring on wheel keeps
// the page scrolling and the value intact. Global so the 90+ raw
// <input type="number"> elements are covered without touching each one.
document.addEventListener(
  'wheel',
  (e) => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'number' && el === e.target) el.blur();
  },
  { passive: true },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
