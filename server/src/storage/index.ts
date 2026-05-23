import { StorageProvider } from './StorageProvider';
import jackalProvider from './jackalProvider';
import obsideoProvider from './obsideoProvider';
import { env } from '../config/env';

export { StorageProvider };

/**
 * getStorageProvider — factory that resolves the correct StorageProvider.
 *
 * @param providerName  Optional override. If omitted, reads `STORAGE_PROVIDER` env var.
 *                      Pass `file.storage_provider` from the DB to route per-file correctly
 *                      (e.g. legacy Jackal files route to jackalProvider even when the active
 *                      provider is Obsideo).
 */
export function getStorageProvider(providerName?: string | null): StorageProvider {
    const name = providerName ?? env.STORAGE_PROVIDER;
    if (name === 'obsideo') return obsideoProvider;
    return jackalProvider;
}
