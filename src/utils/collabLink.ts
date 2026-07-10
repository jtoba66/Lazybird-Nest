import type { MetadataBlob } from '@lazybird-inc/nest-crypto';

interface CollabItem {
    token: string;
    custom_slug?: string | null;
}

// The vault stores collab link keys under a top-level `collab` map keyed by token.
// The protocol preserves unknown top-level keys through encrypt/decrypt, so this
// rides in the existing encrypted metadata blob with no schema/DB change.
type MetaWithCollab = MetadataBlob & { collab?: Record<string, string> };

/**
 * Persist a collab folder's link key (base64url, exactly as it appears in the #lk
 * fragment) into the encrypted metadata vault, keyed by the collab token. This lets
 * the host rebuild the working collab link (copy / QR) at any time — the server never
 * sees the key. Returns a NEW metadata object; the caller must saveMetadata() it.
 */
export function saveCollabLinkKey(metadata: MetadataBlob, token: string, linkKeyBase64url: string): MetadataBlob {
    const next = JSON.parse(JSON.stringify(metadata)) as MetaWithCollab;
    next.collab = next.collab || {};
    next.collab[token] = linkKeyBase64url;
    return next as MetadataBlob;
}

/**
 * Rebuild the complete collab link (with the #lk fragment) from the vault, or null if
 * the key isn't stored (e.g. a folder created before this feature — use Regenerate).
 */
export function getCollabLinkUrl(metadata: MetadataBlob | null, item: CollabItem): string | null {
    const linkKey = (metadata as MetaWithCollab | null)?.collab?.[item.token];
    if (!linkKey) return null;
    return `${window.location.origin}/collab/${item.custom_slug || item.token}#lk=${linkKey}`;
}
