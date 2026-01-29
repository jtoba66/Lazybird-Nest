import { setGlobalDispatcher, Agent } from 'undici';
import http from 'http';
import https from 'https';

// CRITICAL: CosmJS (used by Jackal SDK) uses Node's native http/https, NOT undici
// We must configure the global agents BEFORE any Jackal SDK initialization
http.globalAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 300000, // 5 minutes
    timeout: 0,              // Infinite timeout
    maxSockets: 100,
    maxFreeSockets: 10
});

https.globalAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 300000, // 5 minutes  
    timeout: 0,              // Infinite timeout
    maxSockets: 100,
    maxFreeSockets: 10
});

console.log('[System] Node HTTP/HTTPS agents configured for long-running RPC operations.');

// Still configure undici for any direct fetch() calls

// Create a robust agent optimized for unstable networks and large files
const agent = new Agent({
    // Increase timeouts significantly
    connectTimeout: 60000,   // 60s to connect
    headersTimeout: 60000,   // 60s for headers
    bodyTimeout: 0,          // 0 = no timeout for body (crucial for uploads)

    // Keep-Alive settings
    keepAliveTimeout: 300000, // 5 minutes keep-alive
    keepAliveMaxTimeout: 600000, // 10 minutes max

    // Connection pool limits
    connections: 100,         // Allow more concurrent connections
    pipelining: 1,           // Disable pipelining for stability
});

setGlobalDispatcher(agent);
console.log('[System] Undici Global Dispatcher hardened for stability.');
