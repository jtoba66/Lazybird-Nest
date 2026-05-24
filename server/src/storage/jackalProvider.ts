import { StorageProvider } from './StorageProvider';
import { getJackalHandler, uploadFileToJackal, downloadFileFromJackal, verifyOnGateway } from '../jackal';
import logger from '../utils/logger';

/**
 * JackalProvider — wraps the existing jackal.ts functions behind the StorageProvider interface.
 * Used for legacy files that were originally uploaded to Jackal.
 * No logic changes from the original — this is a pure adapter.
 */
const jackalProvider: StorageProvider = {
    async upload(localPath: string, objectKey: string) {
        const { storage } = await getJackalHandler();
        const result = await uploadFileToJackal(storage, localPath, objectKey);
        return {
            id: result.merkle_hash,
            merkle_root: result.merkle_hash,
            cid: result.cid,
        };
    },

    async download(merkleOrKey: string, objectKey: string, destPath: string) {
        return downloadFileFromJackal(merkleOrKey, objectKey, destPath);
    },

    async delete(_merkleOrKey: string) {
        // Jackal does not have a reliable programmatic delete API.
        // Files expire naturally on Jackal's storage contracts.
        // We log this as a no-op — quota is managed in DB regardless.
        logger.warn(`[JackalProvider] delete() called for ${_merkleOrKey} — Jackal has no delete API, treating as success.`);
        return true;
    },

    async verify(merkleOrKey: string) {
        // Ping Jackal gateway to see if the file is successfully uploaded
        // Timeout set to 10 seconds, retries = 5 based on existing Jackal logic
        try {
            return await verifyOnGateway(merkleOrKey, 5, 10000);
        } catch (err) {
            logger.error(`[JackalProvider] Verification failed for ${merkleOrKey}:`, err);
            return false;
        }
    },
};

export default jackalProvider;
