import sodium from 'libsodium-wrappers';

export interface EncryptedFile {
    encryptedBlob: Blob;
    key: string;  // Hex-encoded encryption key
    nonce: string; // Hex-encoded nonce
}

/**
 * Encrypt a file using XChaCha20-Poly1305
 */
export async function encryptFile(file: File): Promise<EncryptedFile> {
    await sodium.ready;

    // Generate random 256-bit key
    const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);

    // Generate random nonce
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();

    // Encrypt with XChaCha20-Poly1305
    const encrypted = sodium.crypto_secretbox_easy(
        new Uint8Array(fileBuffer),
        nonce as Uint8Array,
        key as Uint8Array
    );

    // Convert to Blob
    const encryptedBlob = new Blob([encrypted as any], { type: 'application/octet-stream' });

    // Convert key and nonce to hex for URL fragment
    const keyHex = sodium.to_hex(key);
    const nonceHex = sodium.to_hex(nonce);

    return {
        encryptedBlob,
        key: keyHex,
        nonce: nonceHex
    };
}

/**
 * Decrypt a file using XChaCha20-Poly1305
 */
export async function decryptFile(
    encryptedBlob: Blob,
    keyHex: string,
    nonceHex: string
): Promise<Blob> {
    await sodium.ready;

    // Convert key and nonce from hex
    const key = sodium.from_hex(keyHex);
    const nonce = sodium.from_hex(nonceHex);

    // Read encrypted blob
    const encryptedBuffer = await encryptedBlob.arrayBuffer();
    const encryptedArray = new Uint8Array(encryptedBuffer);

    // Decrypt
    const decrypted = sodium.crypto_secretbox_open_easy(
        encryptedArray,
        nonce,
        key
    );

    if (!decrypted) {
        throw new Error('Decryption failed - invalid key or corrupted file');
    }

    // Convert back to Blob
    return new Blob([decrypted as any]);
}

/**
 * Generate share link with encryption key in URL fragment
 */
export function generateShareLink(shareToken: string, key: string, nonce: string): string {
    const baseUrl = window.location.origin;
    return `${baseUrl}/file/${shareToken}#${key}:${nonce}`;
}

/**
 * Parse encryption key from URL fragment
 */
export function parseKeyFromFragment(fragment: string): { key: string; nonce: string } | null {
    if (!fragment || !fragment.includes(':')) {
        return null;
    }

    const [key, nonce] = fragment.split(':');

    if (!key || !nonce) {
        return null;
    }

    return { key, nonce };
}
