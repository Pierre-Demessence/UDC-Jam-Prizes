import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';

const container = document.querySelector<HTMLDivElement>('#app');

if (!container)
  throw new Error('index.html is missing the #app container.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
