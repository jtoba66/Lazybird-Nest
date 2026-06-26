import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { StorageProvider } from './StorageProvider';

/**
 * localProvider — a filesystem-backed StorageProvider for LOCAL DEVELOPMENT AND TESTS ONLY.
 *
 * It persists encrypted bytes to a directory on the local disk so that upload → download
 * round-trips work end-to-end without touching Jackal or live Obsideo. Production must never
 * select this provider (STORAGE_PROVIDER is `obsideo` in prod); it exists so the e2e suite can
 * exercise real file download + client-side decrypt against a fully local, isolated harness.
 *
 * Keying: files are stored under STORE_DIR keyed by a sanitized form of the object key. Upload
 * returns `merkle_root === objectKey`, and the upload route persists that as both `obsideo_key`
 * and `merkle_hash`, so every later download/getStream/verify/delete resolves the same path.
 */

const STORE_DIR = path.resolve(__dirname, '../../uploads/local-store');

function keyToPath(key: string): string {
    // Object keys look like `files/42/chunks/0`. Flatten to a safe single filename so we never
    // depend on nested dirs existing, and so upload/download derive the identical path.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(STORE_DIR, safe);
}

function ensureStoreDir(): void {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

const localProvider: StorageProvider = {
    async upload(localPath: string, objectKey: string) {
        ensureStoreDir();
        const dest = keyToPath(objectKey);
        fs.copyFileSync(localPath, dest);
        // A content hash gives us a realistic merkle_root value, but the download key is the
        // objectKey (mirrored into obsideo_key by the route), so storage is keyed by objectKey.
        const buf = fs.readFileSync(dest);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        return { id: objectKey, merkle_root: objectKey, cid: hash };
    },

    async download(merkleOrKey: string, _objectKey: string, destPath: string) {
        const src = keyToPath(merkleOrKey);
        if (!fs.existsSync(src)) return false;
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, destPath);
        return true;
    },

    async delete(merkleOrKey: string) {
        const src = keyToPath(merkleOrKey);
        if (fs.existsSync(src)) fs.unlinkSync(src);
        return true;
    },

    async verify(merkleOrKey: string) {
        return fs.existsSync(keyToPath(merkleOrKey));
    },

    async getStream(merkleOrKey: string): Promise<Readable | null> {
        const src = keyToPath(merkleOrKey);
        if (!fs.existsSync(src)) return null;
        return fs.createReadStream(src);
    },
};

export default localProvider;
