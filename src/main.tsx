import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import * as Sentry from "@sentry/react";
import App from './App.tsx'
import { HelmetProvider } from 'react-helmet-async';

// Strip the URL fragment AND query before anything reaches Sentry. The fragment
// carries share/collab decryption secrets (#key=, #lk=) and the query may carry
// tokens — neither may ever leave the browser (zero-knowledge guarantee).
const stripUrlSecrets = (url?: unknown): string | undefined => {
  if (typeof url !== 'string') return undefined;
  return url.split('#')[0].split('?')[0];
};
const scrubBreadcrumbUrls = (data?: Record<string, any> | null) => {
  if (!data) return;
  for (const k of ['url', 'to', 'from']) {
    if (typeof data[k] === 'string') data[k] = stripUrlSecrets(data[k]);
  }
};

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  sendDefaultPii: false, // don't attach IP / user identifiers
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.browserTracingIntegration(),
    // Session Replay is deliberately NOT enabled: it records the DOM (which holds
    // decrypted filenames/folder names) and the page URL (which holds the #key=/#lk=
    // decryption secrets) — capturing either would defeat zero-knowledge.
  ],
  // Performance Monitoring
  tracesSampleRate: 1.0,
  // Defense-in-depth: scrub the secret-bearing fragment/query from every event.
  beforeSend(event) {
    if (event.request?.url) event.request.url = stripUrlSecrets(event.request.url) ?? event.request.url;
    event.breadcrumbs?.forEach(b => scrubBreadcrumbUrls(b.data));
    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    scrubBreadcrumbUrls(breadcrumb.data);
    return breadcrumb;
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>,
)
