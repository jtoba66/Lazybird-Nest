import fs from 'fs';
import { StorageProvider } from './StorageProvider';
import { env } from '../config/env';
import logger from '../utils/logger';

// Lazily initialised — only created when first method is called.
// Uses dynamic import because @obsideo/sdk is ESM-only and our server compiles as CommonJS.
let _clientPromise: Promise<any> | null = null;

async function getClient(): Promise<any> {
    if (_clientPromise) return _clientPromise;

    _clientPromise = (async () => {
        const { ObsideoClient, FilesystemBundleStore } = await import('@obsideo/sdk');

        if (
            !env.OBSIDEO_API_KEY ||
            !env.OBSIDEO_ACCOUNT_ID ||
            !env.OBSIDEO_CUSTOMER_PUBLIC_KEY ||
            !env.OBSIDEO_CUSTOMER_PRIVATE_KEY ||
            !env.OBSIDEO_COORDINATOR_PUBLIC_KEY
        ) {
            throw new Error(
                '[ObsideoProvider] Missing required Obsideo credentials. ' +
                'Ensure OBSIDEO_API_KEY, OBSIDEO_ACCOUNT_ID, OBSIDEO_CUSTOMER_PUBLIC_KEY, ' +
                'OBSIDEO_CUSTOMER_PRIVATE_KEY, and OBSIDEO_COORDINATOR_PUBLIC_KEY are set in Doppler.'
            );
        }

        const bundleStorePath = env.OBSIDEO_BUNDLE_STORE_PATH;

        // FilesystemBundleStore has a private constructor — must use the async .open() factory.
        // encryptionMode: 'external' tells the store that Nest handles its own E2EE;
        // the bundle header is written once and is immutable thereafter.
        const bundleStore = await FilesystemBundleStore.open(
            bundleStorePath,
            env.OBSIDEO_ACCOUNT_ID,
            undefined,          // createdAt — defaults to now
            'external'          // Nest does its own ZK encryption; Obsideo stores opaque bytes
        );

        logger.info(`[ObsideoProvider] Bundle store opened at: ${bundleStorePath}`);

        const client = new ObsideoClient({
            coordinatorUrl: env.OBSIDEO_COORDINATOR_URL,
            accountId: env.OBSIDEO_ACCOUNT_ID,
            apiKey: env.OBSIDEO_API_KEY,
            customerPublicKey: env.OBSIDEO_CUSTOMER_PUBLIC_KEY,
            customerPrivateKey: env.OBSIDEO_CUSTOMER_PRIVATE_KEY,
            coordinatorPublicKey: env.OBSIDEO_COORDINATOR_PUBLIC_KEY,   // required field
            bundleStore,
            encryptionMode: 'external',   // never re-encrypt already-encrypted blobs
        });

        logger.info('[ObsideoProvider] ObsideoClient initialised.');
        return client;
    })();

    return _clientPromise;
}

// Bucket name — all Nest files live under a single bucket.
const BUCKET = 'nest';

/**
 * ObsideoProvider — implements StorageProvider using @obsideo/sdk.
 * All uploads use encrypt:false (encryptionMode:'external') because Nest
 * performs its own client-side ZK encryption before bytes reach the server.
 */
const obsideoProvider: StorageProvider = {
    async upload(localPath: string, objectKey: string) {
        const client = await getClient();
        logger.info(`[ObsideoProvider] Uploading ${objectKey} from ${localPath}`);

        const fileBuffer = await fs.promises.readFile(localPath);
        const result = await client.putObject(BUCKET, objectKey, fileBuffer, { encrypt: false });

        // putObject returns a PutObjectResult — merkle_root is the content hash.
        const merkle = result?.merkle_root ?? result?.id ?? objectKey;
        logger.info(`[ObsideoProvider] ✅ Uploaded ${objectKey} (merkle: ${merkle})`);

        return {
            id: objectKey,
            merkle_root: merkle,
        };
    },

    async download(merkleOrKey: string, _objectKey: string, destPath: string) {
        const client = await getClient();
        logger.info(`[ObsideoProvider] Downloading key=${merkleOrKey} → ${destPath}`);

        try {
            const result = await client.getObject(BUCKET, merkleOrKey);
            if (!result) {
                logger.error(`[ObsideoProvider] ❌ getObject returned null for key ${merkleOrKey}`);
                return false;
            }

            // getObject may return a GetResult with a data property, or raw bytes.
            const raw = result?.data ?? result;
            const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            await fs.promises.writeFile(destPath, buffer);
            logger.info(`[ObsideoProvider] ✅ Downloaded ${merkleOrKey} (${buffer.length} bytes)`);
            return true;
        } catch (err: any) {
            logger.error(`[ObsideoProvider] ❌ Download failed for ${merkleOrKey}: ${err.message}`);
            return false;
        }
    },

    async delete(merkleOrKey: string) {
        const client = await getClient();
        logger.info(`[ObsideoProvider] Deleting key=${merkleOrKey}`);

        try {
            await client.deleteObject(BUCKET, merkleOrKey);
            logger.info(`[ObsideoProvider] ✅ Deleted ${merkleOrKey}`);
            return true;
        } catch (err: any) {
            logger.error(`[ObsideoProvider] ❌ Delete failed for ${merkleOrKey}: ${err.message}`);
            return false;
        }
    },
};

export default obsideoProvider;
