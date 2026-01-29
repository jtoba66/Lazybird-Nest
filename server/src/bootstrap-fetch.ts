// bootstrap-fetch.ts (import FIRST)
import { Agent, fetch, Headers, Request, Response } from "undici";

// 1. Strict Agent (For Storage Providers to prevent Body Unusable / Reused Socket Issues)
const strictAgent = new Agent({
    connections: 1,
    pipelining: 0,
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
});

// 2. Relaxed Agent (For RPC / API / Standard Calls to avoid 502 Rate Limits)
const relaxedAgent = new Agent({
    connections: 100,
    keepAliveTimeout: 10000, // 10s
    keepAliveMaxTimeout: 10000,
});

// Smart Fetch Override
(globalThis as any).fetch = (url: any, init: any = {}) => {
    // Convert URL object to string if needed
    const urlStr = url.toString();

    // Check if targeting Jackal Protocol RPC/API
    const isRpc = urlStr.includes('jackalprotocol.com') ||
        urlStr.includes('lazybird.io') ||
        urlStr.includes('localhost');

    // Use Relaxed Agent for RPCs, Strict for everything else (Providers)
    const agent = isRpc ? relaxedAgent : strictAgent;

    return fetch(url, { ...init, dispatcher: agent });
};

(globalThis as any).Headers = Headers;
(globalThis as any).Request = Request;
(globalThis as any).Response = Response;
