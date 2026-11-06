import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles/globals.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app/App';
import { DesignPage } from './app/DesignPage';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing.');

// The packaged app has no browser context menu: it exposes browser chrome and
// copy/inspect affordances that a vault should never offer.
if (import.meta.env.PROD) {
  window.addEventListener('contextmenu', (event) => event.preventDefault());
}

const design = import.meta.env.DEV && new URLSearchParams(window.location.search).has('design');

ReactDOM.createRoot(root).render(
  <React.StrictMode>{design ? <DesignPage /> : <App />}</React.StrictMode>,
);
