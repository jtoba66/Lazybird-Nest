// @ts-ignore ws has no types bundled here
import WebSocket from "ws";
import { ClientHandler, IChainConfig } from "@jackallabs/jackal.js";
// import { File } from 'buffer'; // Use Global File
import fs from 'fs';
import axios from 'axios';
import mime from 'mime-types';
import { env } from './config/env';

(globalThis as any).WebSocket = WebSocket;

let cachedContextPromise: Promise<{ storage: any; address: string }> | null = null;

function isTransient(err: any): boolean {
    const msg = String(err?.message || "").toLowerCase();
    const code = err?.cause?.code || err?.code;

    // Check nested cause message too
    const causeMsg = err?.cause?.message ? String(err.cause.message).toLowerCase() : "";

    if (code === "UND_ERR_SOCKET") return true;
    if (code === "UND_ERR_CONNECT_TIMEOUT") return true;
    if (msg.includes("fetch failed") || causeMsg.includes("connect timeout")) return true;
    if (msg.includes("other side closed")) return true;
    if (msg.includes("socket hang up")) return true;
    return false;
}

async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 1500): Promise<T> {
    let lastErr: unknown;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn();
        } catch (err: unknown) {
            lastErr = err;
            if (!isTransient(err) || i === attempts) throw err;
            const delay = baseDelayMs * i;
            const msg =
                err && typeof err === "object" && "message" in err
                    ? String((err as any).message)
                    : String(err);
            console.warn(`[Jackal] transient error (attempt ${i}/${attempts}), retrying in ${delay}ms`, msg);
            await new Promise((res) => setTimeout(res, delay));
        }
    }
    throw lastErr as any;
}

export async function getJackalHandler(freshSession = false) {
    if (!freshSession && cachedContextPromise) return cachedContextPromise;

    const promise = (async () => {
        const mnemonic = env.JACKAL_SEED;
        const rpcEndpoint = env.JACKAL_RPC_URL;
        const restEndpoint = env.JACKAL_API_URL;

        const chainConfig: IChainConfig = {
            chainId: "jackal-1",
            chainName: "Jackal Mainnet",
            rpc: rpcEndpoint,
            rest: restEndpoint,
            bip44: { coinType: 118 },
            stakeCurrency: { coinDenom: "JKL", coinMinimalDenom: "ujkl", coinDecimals: 6 },
            bech32Config: {
                bech32PrefixAccAddr: "jkl",
                bech32PrefixAccPub: "jklpub",
                bech32PrefixValAddr: "jklvaloper",
                bech32PrefixValPub: "jklvaloperpub",
                bech32PrefixConsAddr: "jklvalcons",
                bech32PrefixConsPub: "jklvalconspub"
            },
            currencies: [{ coinDenom: "JKL", coinMinimalDenom: "ujkl", coinDecimals: 6 }],
            feeCurrencies: [{ coinDenom: "JKL", coinMinimalDenom: "ujkl", coinDecimals: 6, gasPriceStep: { low: 0.002, average: 0.002, high: 0.02 } }],
            features: []
        };

        console.log(`[Jackal] Connecting to ${rpcEndpoint}...`);

        const client = await retryWithBackoff(() => ClientHandler.connect({
            chainConfig,
            chainId: "jackal-1",
            endpoint: rpcEndpoint,
            mnemonic,
            selectedWallet: "mnemonic",
            networks: ["jackal"]
        }), 3, 5000);

        const address = client.getJackalAddress();
        console.log(`[Jackal] Wallet connected: ${address}`);

        const storage = await client.createStorageHandler();
        await storage.upgradeSigner();

        // Reduce block-height polling to avoid frequent RPC failures
        (storage as any).proofInterval = 9_999_999;

        try {
            await storage.initStorage();
        } catch (e) {
            console.warn("[Jackal] initStorage warning (possibly already initialized), checking Home...", e);
            await storage.loadDirectory({ path: "Home" });
        }

        await storage.loadProviderPool();
        await storage.loadDirectory({ path: "Home" });

        return { storage, address };
    })();

    if (!freshSession) cachedContextPromise = promise;
    return promise;
}

export async function uploadFileToJackal(storage: any, filePath: string, fileName: string) {
    const folderPath = "Home/media-converter";

    // 1. Ensure Directory Exists (Standard Retry Logic)
    try {
        await retryWithBackoff(() => storage.loadDirectory({ path: folderPath }));
    } catch {
        // try to create under Home
        await retryWithBackoff(() => storage.loadDirectory({ path: "Home" }));
        const check = await storage.checkContentInFolder({ path: "Home", name: "media-converter" });
        if (!check || check.error) {
            await retryWithBackoff(() => storage.createFolders({ names: ["media-converter"] }));
        }
        await retryWithBackoff(() => storage.loadDirectory({ path: folderPath }));
    }

    // 2. Upload (Standard SDK Flow)
    const mimeType = mime.lookup(fileName) || 'application/octet-stream';
    console.log(`[Jackal] Content-Type: ${mimeType}`);

    // Create File Object (Node.js Buffer -> File)
    // CRITICAL: Use async readFile to prevent blocking event loop on large files (2GB+)
    // Blocking reads cause socket timeouts during the 5-10s read operation
    console.log(`[Jackal] Reading file asynchronously...`);
    const fileBuffer = await fs.promises.readFile(filePath);
    const file = new File([fileBuffer], fileName, { type: mimeType });
    let capturedMerkle = "";
    let capturedCid = "";
    let progress100 = false;

    (file as any).onProgress = (p: any) => {
        if (p?.progress === 100) {
            progress100 = true;
            if (p?.merkle) {
                capturedMerkle = p.merkle;
                if (p.cid) capturedCid = p.cid;
            }
        }
    };
    console.log(`[Jackal] File created from buffer. Size: ${file.size} bytes`);

    console.log(`[Jackal] Queueing ${fileName} for upload...`);
    await storage.queuePublic([file]);

    console.log("[Jackal] Processing Queue (Standard)...");

    // Retry UploadHandler.uploadFile for transient fetch errors
    const storageAny: any = storage;
    if (storageAny.uh && typeof storageAny.uh.uploadFile === "function") {
        const originalUploadFile = storageAny.uh.uploadFile.bind(storageAny.uh);
        storageAny.uh.uploadFile = async (fileObj: any, ...args: any[]) => {
            return await retryWithBackoff(() => originalUploadFile(fileObj, ...args), 3, 2000);
        };
    }

    // Capture provider progress events emitted via storage.em.emit
    if (storageAny.em && typeof storageAny.em.emit === "function") {
        const originalEmit = storageAny.em.emit.bind(storageAny.em);
        storageAny.em.emit = (event: string, data: any) => {
            if (event === "upload-progress" && data && data.progress === 100) {
                progress100 = true;
                if (data.merkle) {
                    capturedMerkle = data.merkle;
                    if (data.cid) capturedCid = data.cid;
                }
            }
            return originalEmit(event, data);
        };
    }

    let processResult: any = null;

    // CRITICAL: Jackal SDK logs progress via console.log, not events
    // We must intercept console.log to capture merkle hash
    const originalLog = console.log;
    console.log = (...args: any[]) => {
        originalLog(...args); // Still log normally

        // Capture progress events that contain merkle
        if (args.length >= 2 && args[0] === 'progress:' && args[1] === 100 && typeof args[2] === 'object') {
            const progressData = args[2];
            progress100 = true;
            if (progressData?.merkle) {
                capturedMerkle = progressData.merkle;
                if (progressData.cid) capturedCid = progressData.cid;
                originalLog(`[Jackal] ✅ Captured Merkle from progress event: ${capturedMerkle}`);
            }
        }
    };

    try {
        const ret = await retryWithBackoff(() => storage.processAllQueues(), 5, 3000);
        processResult = ret;
    } catch (err: any) {
        console.error("[Jackal] Upload Failed:", err);
        throw err;
    } finally {
        console.log = originalLog; // Restore original
    }

    // 3. Extract Proof of Success (Merkle)
    if (processResult && processResult.txResponse) {
        const txResp = processResult.txResponse as any;

        // Structured events first
        if (Array.isArray(txResp.events)) {
            for (const ev of txResp.events) {
                if (ev?.type !== "post_file") continue;
                const attr = ev.attributes?.find((a: any) => a?.key === "file");
                if (attr?.value) {
                    capturedMerkle = attr.value;
                    const cidAttr = ev.attributes?.find((a: any) => a?.key === "cid");
                    if (cidAttr?.value) capturedCid = cidAttr.value;
                    break;
                }
            }
        }

        // Fallback: rawLog parse
        if (txResp.rawLog && typeof txResp.rawLog === "string" && !capturedMerkle) {
            try {
                const logs = JSON.parse(txResp.rawLog);
                for (const log of logs) {
                    for (const event of log.events || []) {
                        if (event.type === 'post_file') {
                            const attr = event.attributes.find((a: any) => a.key === 'file');
                            if (attr && attr.value) {
                                capturedMerkle = attr.value;
                                console.log(`[Jackal] Captured Merkle from Storage Event: ${capturedMerkle}`);
                                break;
                            }
                        }
                    }
                    if (capturedMerkle) break;
                }
            } catch (e) {
                console.warn("[Jackal] Failed to parse txResponse rawLog:", e);
            }
        }
    }

    // Fallback: Check if SDK attached it to result object
    if (!capturedMerkle && processResult && processResult.merkle) {
        capturedMerkle = processResult.merkle;
    }
    if (!capturedCid && processResult && processResult.cid) {
        capturedCid = processResult.cid;
    }

    // Format conversion: base64 to hex if needed
    // Merkle must be 64-char hex
    if (capturedMerkle && capturedMerkle.length !== 64) {
        try {
            // Check if it's base64 (approx 44 chars)
            if (capturedMerkle.length < 64) {
                const buf = Buffer.from(capturedMerkle, 'base64');
                if (buf.length === 32) {
                    const hex = buf.toString('hex');
                    console.log(`[Jackal] Converting Base64 Merkle to Hex: ${capturedMerkle} -> ${hex}`);
                    capturedMerkle = hex;
                }
            }
        } catch (e) {
            console.warn("[Jackal] Merkle conversion failed:", (e as any).message);
        }
    }

    // FINAL VALIDATION: Merkle + Progress 100
    if (!capturedMerkle || !progress100) {
        const err = !progress100
            ? "Upload reached end of process but never signaled 100% progress."
            : "Upload signaled 100% progress but Merkle hash was missing.";
        console.error(`[Jackal] ❌ Success Validation Failed: ${err}`);
        throw new Error(err);
    }

    console.log(`[Jackal] ✅ Final Success Link: Merkle ${capturedMerkle}, Progress 100%`);

    const finalStats = fs.statSync(filePath);
    return {
        success: true,
        merkle_hash: capturedMerkle,
        cid: capturedCid || undefined,
        size: finalStats.size
    };
}

/**
 * Verifies a file exists on the Jackal gateway.
 * Used for asynchronous post-upload verification.
 */
export async function verifyOnGateway(merkle: string, maxAttempts = 10, delayMs = 30000): Promise<boolean> {
    const gatewayUrl = `https://gateway.lazybird.io/file/${merkle}`;

    for (let i = 1; i <= maxAttempts; i++) {
        try {
            console.log(`[Jackal-Verify] Attempting gateway check ${i}/${maxAttempts} for ${merkle}...`);
            const res = await axios.head(gatewayUrl, { timeout: 10000 });
            if (res.status === 200) {
                console.log(`[Jackal-Verify] ✅ File verified on gateway: ${merkle}`);
                return true;
            }
        } catch (err: any) {
            console.warn(`[Jackal-Verify] Verification pending (${err.message})`);
        }

        if (i < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    console.error(`[Jackal-Verify] ❌ Verification timed out after ${maxAttempts} attempts for ${merkle}`);
    return false;
}

// Helper to Download from Jackal (Hydration)
export async function downloadFileFromJackal(merkle: string, filename: string, destPath: string): Promise<boolean> {
    const gateWays = [
        'https://gateway.lazybird.io'
    ];

    console.log(`[Jackal Hydrate] Attempting to download ${filename} (merkle: ${merkle})`);

    // Try each gateway
    for (const gw of gateWays) {
        try {
            const url = `${gw}/file/${merkle}?name=${encodeURIComponent(filename)}`;
            console.log(`[Jackal Hydrate] Fetching from ${gw}...`);

            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: 30000 // 30s timeout
            });

            const writer = fs.createWriteStream(destPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log(`[Jackal Hydrate] Success! Saved to ${destPath}`);
                    resolve(true);
                });
                writer.on('error', (err) => {
                    console.error(`[Jackal Hydrate] Write error:`, err);
                    reject(false);
                });
            });

            return true; // Success

        } catch (e: any) {
            console.warn(`[Jackal Hydrate] Failed on ${gw}: ${e.message}`);
            continue; // Try next gateway
        }
    }

    console.error(`[Jackal Hydrate] All gateways failed for ${merkle}`);
    return false;
}
