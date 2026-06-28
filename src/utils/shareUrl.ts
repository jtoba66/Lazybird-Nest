import api from '../lib/api';

/**
 * Minimal shape of a share row needed to build its URL.
 * (Matches the relevant fields of ShareItem without coupling to it.)
 */
export interface ShareUrlItem {
    id: number;
    token: string;
    custom_slug: string | null;
    name?: string;
}

type MetadataLike = { files: Record<string, { filename?: string; mime_type?: string }> } | null;

/**
 * Re-derive the COMPLETE standard-link share URL — including the `#key`
 * fragment (`/s/<token>#key=...&name=...&mime=...`).
 *
 * For standard file links the decryption key lives ONLY in the URL fragment and
 * is never stored server-side, so anything that DISPLAYS, COPIES, or ENCODES the
 * link (the link field, the copy button, every QR code) must reconstruct it from
 * the in-session master key. This is the single source of truth for that
 * derivation — call it from every such surface so they can never diverge again.
 * (Drop zones carry no secret in the URL; collab links use a `#lk` linkKey that
 * is not stored server-side and must be regenerated, so neither uses this.)
 *
 * @throws if the vault is locked or the file keys can't be fetched/decrypted.
 */
export async function deriveStandardLinkUrl(
    item: ShareUrlItem,
    masterKey: Uint8Array | null,
    metadata: MetadataLike,
): Promise<string> {
    if (!masterKey) throw new Error('Vault is locked — master key unavailable');

    const { decryptFolderKey, decryptFileKey, toBase64, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
    await init();

    const { data } = await api.get(`/files/download/${item.id}`);
    const folderKey = decryptFolderKey(fromBase64(data.folder_key_encrypted), fromBase64(data.folder_key_nonce), masterKey);
    const fileKey = decryptFileKey(fromBase64(data.file_key_encrypted), fromBase64(data.file_key_nonce), folderKey);

    const filename = metadata?.files[item.id.toString()]?.filename || item.name || 'file';
    const mimeType = metadata?.files[item.id.toString()]?.mime_type || 'application/octet-stream';

    return `${window.location.origin}/s/${item.custom_slug || item.token}` +
        `#key=${encodeURIComponent(toBase64(fileKey))}` +
        `&name=${encodeURIComponent(filename)}` +
        `&mime=${encodeURIComponent(mimeType)}`;
}
