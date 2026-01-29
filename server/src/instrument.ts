import * as dotenv from "dotenv";
import path from "path";
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

console.log(`[Sentry] Initializing... DSN present: ${!!process.env.SENTRY_DSN}`);

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    debug: false, // Turn off noisy logs, but DSN is now fixed!
    integrations: [
        nodeProfilingIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0,
    // Set sampling rate for profiling - this is relative to tracesSampleRate
    profilesSampleRate: 1.0,
    sendDefaultPii: true,
    environment: process.env.NODE_ENV || 'development',
});
