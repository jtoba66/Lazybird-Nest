const crypto = (window as any).NestCrypto;

if (!crypto) {
    throw new Error('NestCrypto is not loaded. Ensure the SRI script tag is present in index.html.');
}

export const init = crypto.init;
export const encryptFile = crypto.encryptFile;
export const generateFileKey = crypto.generateFileKey;
export const encryptFileKey = crypto.encryptFileKey;
export const encryptFolderKey = crypto.encryptFolderKey;
export const toBase64 = crypto.toBase64;
export const fromBase64 = crypto.fromBase64;
export const encryptChunk = crypto.encryptChunk;
export const decryptFolderKey = crypto.decryptFolderKey;
export const decryptFileKey = crypto.decryptFileKey;
export const decryptFile = crypto.decryptFile;
export const deriveRootKey = crypto.deriveRootKey;
export const deriveAuthHash = crypto.deriveAuthHash;
export const decryptMasterKey = crypto.decryptMasterKey;
export const deriveWrappingKey = crypto.deriveWrappingKey;
export const decryptMetadataBlob = crypto.decryptMetadataBlob;
export const encryptMetadataBlob = crypto.encryptMetadataBlob;
export const generateFolderKey = crypto.generateFolderKey;
export const decryptChunk = crypto.decryptChunk;
export const generateMasterKey = crypto.generateMasterKey;
export const encryptMasterKey = crypto.encryptMasterKey;
export const generateSalt = crypto.generateSalt;
export const createDecryptionStream = crypto.createDecryptionStream;
export const createEncryptionStream = crypto.createEncryptionStream;
