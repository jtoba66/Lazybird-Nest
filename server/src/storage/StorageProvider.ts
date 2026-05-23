/**
 * StorageProvider — common interface for any file storage backend.
 * Both JackalProvider and ObsideoProvider implement this.
 */
export interface StorageProvider {
    /**
     * Upload a local file to the storage backend.
     * @param localPath  Absolute path to the encrypted file on disk.
     * @param objectKey  Logical key to store under (e.g. `files/42`).
     * @returns id       Provider-specific identifier (merkle hash, object key, etc.)
     *          merkle_root  Content hash usable for integrity checks / DB storage.
     *          cid      Optional IPFS CID if the provider returns one.
     */
    upload(localPath: string, objectKey: string): Promise<{ id: string; merkle_root: string; cid?: string }>;

    /**
     * Download a file from the storage backend to a local path.
     * @param merkleOrKey  Jackal merkle hash OR Obsideo object key depending on provider.
     * @param objectKey    Human-readable name used for logging / temp file naming.
     * @param destPath     Absolute path to write the downloaded bytes to.
     * @returns true on success, false on failure.
     */
    download(merkleOrKey: string, objectKey: string, destPath: string): Promise<boolean>;

    /**
     * Permanently delete an object from the storage backend.
     * @param merkleOrKey  Jackal merkle hash OR Obsideo object key.
     * @returns true on success, false on failure (caller decides whether to retry).
     */
    delete(merkleOrKey: string): Promise<boolean>;
}
