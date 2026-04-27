import React from 'react';
import ReactDOM from 'react-dom/client';
import { pdfjs } from 'react-pdf';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import App from '../src/App';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import '../src/app/globals.css';

// Centralized PDF.js worker setup — Vite's ?url suffix resolves npm packages
// correctly and emits the file as a hashed static asset (same-origin, CSP-safe).
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    mountApp();
  });
} else {
  mountApp();
}

function mountApp() {
  const rootElement = document.getElementById('root') || document.getElementById('app');
  
  if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
  }
}