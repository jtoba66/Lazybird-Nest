import { useAuth } from '../contexts/AuthContext';
import { foldersAPI } from '../api/folders';

/**
 * Returns a function that creates a zero-knowledge folder: generates a folder key,
 * wraps it with the master key, creates the folder server-side, and records the
 * (plaintext) name in the encrypted metadata vault. Shared by the Access & Sharing
 * page and the Folder Manager so collab folders / drop zones can be created from both.
 */
export function useCreateZKFolder() {
    const { masterKey, metadata, saveMetadata } = useAuth();

    return async (folderName: string): Promise<number> => {
        if (!masterKey || !metadata) throw new Error('Auth components missing');
        const { generateFolderKey, encryptFolderKey, toBase64, init } = await import('@lazybird-inc/nest-crypto');
        await init();

        const folderKey = generateFolderKey();
        const { encrypted, nonce } = encryptFolderKey(folderKey, masterKey);

        const res = await foldersAPI.create(toBase64(encrypted), toBase64(nonce), folderName);
        const newId = res.folder_id;

        const newMeta = JSON.parse(JSON.stringify(metadata));
        newMeta.folders[newId.toString()] = {
            name: folderName,
            created_at: new Date().toISOString(),
        };
        await saveMetadata(newMeta);

        return newId;
    };
}
