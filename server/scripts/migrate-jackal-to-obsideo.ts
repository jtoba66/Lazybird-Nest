/**
 * migrate-jackal-to-obsideo.ts
 *
 * One-shot migration script: moves all files from Jackal → Obsideo.
 *
 * Safety features:
 *  - Idempotent: skips files where migration_status IS NOT NULL.
 *  - --dry-run flag: logs what it would do without touching anything.
 *  - Per-file DB commit: crash mid-run is resumable.
 *  - Concurrency: 2 files at a time (configurable via CONCURRENCY const).
 *  - Full log to stdout + /var/nest/migration-log.jsonl (or --log-file override).
 *
 * Recovery priority for each file/chunk:
 *  1. local_path / encrypted_file_path on disk (fastest — no network hop)
 *  2. Jackal public gateway (https://gateway.lazybird.io/file/:merkle_hash)
 *  3. Mark as 'broken' (neither source is available)
 *
 * Usage:
 *   doppler run -- npx ts-node --transpile-only scripts/migrate-jackal-to-obsideo.ts [--dry-run] [--log-file /path/to/log.jsonl]
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRY_RUN = process.argv.includes('--dry-run');
const LOG_FILE_ARG = process.argv.indexOf('--log-file');
const LOG_FILE = LOG_FILE_ARG !== -1 ? process.argv[LOG_FILE_ARG + 1] : '/var/nest/migration-log.jsonl';
const CONCURRENCY = 2;
const JACKAL_GATEWAY = 'https://gateway.lazybird.io';
const BUCKET = 'nest';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(level: 'info' | 'warn' | 'error' | 'dry', obj: Record<string, any>) {
    const entry = { ts: new Date().toISOString(), level, ...obj };
    console.log(JSON.stringify(entry));
    if (!DRY_RUN) {
        try {
            const dir = path.dirname(LOG_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
        } catch { /* non-fatal */ }
    }
}

// ---------------------------------------------------------------------------
// Obsideo client (ESM dynamic import)
// ---------------------------------------------------------------------------
let _obsideo: any = null;
async function getObsideo() {
    if (_obsideo) return _obsideo;
    const { ObsideoClient, FilesystemBundleStore } = await import('@obsideo/sdk');

    const required = [
        'OBSIDEO_API_KEY', 'OBSIDEO_ACCOUNT_ID',
        'OBSIDEO_CUSTOMER_PUBLIC_KEY', 'OBSIDEO_CUSTOMER_PRIVATE_KEY',
        'OBSIDEO_COORDINATOR_PUBLIC_KEY'
    ];
    for (const k of required) {
        if (!process.env[k]) throw new Error(`Missing env var: ${k}`);
    }

    const bundleStorePath = process.env.OBSIDEO_BUNDLE_STORE_PATH || '/var/nest/obsideo-bundle';
    const bundleStore = await FilesystemBundleStore.open(
        bundleStorePath,
        process.env.OBSIDEO_ACCOUNT_ID!,
        undefined,
        'external'
    );

    _obsideo = new ObsideoClient({
        coordinatorUrl: process.env.OBSIDEO_COORDINATOR_URL || 'https://coordinator.obsideo.io',
        accountId: process.env.OBSIDEO_ACCOUNT_ID!,
        apiKey: process.env.OBSIDEO_API_KEY!,
        customerPublicKey: process.env.OBSIDEO_CUSTOMER_PUBLIC_KEY!,
        customerPrivateKey: process.env.OBSIDEO_CUSTOMER_PRIVATE_KEY!,
        coordinatorPublicKey: process.env.OBSIDEO_COORDINATOR_PUBLIC_KEY!,
        bundleStore,
        encryptionMode: 'external',
    });
    log('info', { msg: 'ObsideoClient initialised' });
    return _obsideo;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Upload a local file to Obsideo. Returns merkle_root or throws. */
async function uploadToObsideo(localPath: string, objectKey: string): Promise<string> {
    const client = await getObsideo();
    const fileBuffer = await fs.promises.readFile(localPath);
    const result = await client.putObject(BUCKET, objectKey, fileBuffer, { encrypt: false });
    return result?.merkle_root ?? result?.id ?? objectKey;
}

/** Download a file from Jackal gateway to a temp file. Returns temp path or null on failure. */
async function downloadFromJackal(merkle: string, label: string): Promise<string | null> {
    const url = `${JACKAL_GATEWAY}/file/${merkle}`;
    const tmpPath = path.join(os.tmpdir(), `nest-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await axios({ method: 'GET', url, responseType: 'stream', timeout: 300_000 });
            const writer = fs.createWriteStream(tmpPath);
            response.data.pipe(writer);
            await new Promise<void>((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            return tmpPath;
        } catch (e: any) {
            log('warn', { msg: `Jackal download attempt ${attempt}/3 failed`, label, merkle, err: e.message });
            if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
        }
    }
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    return null;
}

/** Remove a temp file silently. */
function cleanupTmp(p: string | null) {
    if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// Migrate a single non-chunked file
// ---------------------------------------------------------------------------
async function migrateFile(sql: any, file: any): Promise<'migrated' | 'broken'> {
    const objectKey = `files/${file.id}`;
    let tmpPath: string | null = null;

    try {
        let sourcePath: string | null = null;
        let sourceLabel = '';

        // 1. Recovery path: local disk
        if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
            sourcePath = file.encrypted_file_path;
            sourceLabel = 'local_cache';
        }

        // 2. Jackal gateway
        if (!sourcePath) {
            const validMerkle = file.merkle_hash &&
                !['pending', 'pending-chunks', 'chunked-complete'].includes(file.merkle_hash);
            if (validMerkle) {
                log('info', { msg: 'Downloading from Jackal', file_id: file.id, merkle: file.merkle_hash });
                tmpPath = await downloadFromJackal(file.merkle_hash, `file_${file.id}`);
                if (tmpPath) {
                    sourcePath = tmpPath;
                    sourceLabel = 'jackal_gateway';
                }
            }
        }

        if (!sourcePath) {
            log('error', { msg: 'No source available — marking broken', file_id: file.id });
            if (!DRY_RUN) {
                await sql`UPDATE files SET migration_status = 'broken' WHERE id = ${file.id}`;
            }
            return 'broken';
        }

        log(DRY_RUN ? 'dry' : 'info', {
            msg: DRY_RUN ? '[DRY-RUN] Would upload file' : `Uploading file (source: ${sourceLabel})`,
            file_id: file.id, objectKey, source: sourceLabel
        });

        if (!DRY_RUN) {
            await uploadToObsideo(sourcePath, objectKey);
            await sql`
                UPDATE files
                SET storage_provider = 'obsideo',
                    obsideo_key = ${objectKey},
                    migration_status = 'migrated'
                WHERE id = ${file.id}
            `;
        }

        log(DRY_RUN ? 'dry' : 'info', { msg: 'File migrated', file_id: file.id, objectKey });
        return 'migrated';

    } finally {
        cleanupTmp(tmpPath);
    }
}

// ---------------------------------------------------------------------------
// Migrate a single chunked file (all its chunks)
// ---------------------------------------------------------------------------
async function migrateChunkedFile(sql: any, file: any): Promise<'migrated' | 'broken'> {
    const chunks = await sql`
        SELECT id, chunk_index, jackal_merkle, local_path, size
        FROM file_chunks
        WHERE file_id = ${file.id}
        ORDER BY chunk_index ASC
    `;

    if (chunks.length === 0) {
        log('warn', { msg: 'Chunked file has no chunk records — marking broken', file_id: file.id });
        if (!DRY_RUN) await sql`UPDATE files SET migration_status = 'broken' WHERE id = ${file.id}`;
        return 'broken';
    }

    let allMigrated = true;

    for (const chunk of chunks) {
        const objectKey = `files/${file.id}/chunks/${chunk.chunk_index}`;
        let tmpPath: string | null = null;

        try {
            let sourcePath: string | null = null;
            let sourceLabel = '';

            // 1. Recovery path: local disk
            if (chunk.local_path && fs.existsSync(chunk.local_path)) {
                sourcePath = chunk.local_path;
                sourceLabel = 'local_cache';
            }

            // 2. Jackal gateway
            if (!sourcePath) {
                const validMerkle = chunk.jackal_merkle && chunk.jackal_merkle !== 'pending';
                if (validMerkle) {
                    log('info', { msg: 'Downloading chunk from Jackal', file_id: file.id, chunk_index: chunk.chunk_index, merkle: chunk.jackal_merkle });
                    tmpPath = await downloadFromJackal(chunk.jackal_merkle, `file_${file.id}_chunk_${chunk.chunk_index}`);
                    if (tmpPath) {
                        sourcePath = tmpPath;
                        sourceLabel = 'jackal_gateway';
                    }
                }
            }

            if (!sourcePath) {
                log('error', { msg: 'Chunk has no source — will mark file broken', file_id: file.id, chunk_index: chunk.chunk_index });
                allMigrated = false;
                continue;
            }

            log(DRY_RUN ? 'dry' : 'info', {
                msg: DRY_RUN ? '[DRY-RUN] Would upload chunk' : `Uploading chunk (source: ${sourceLabel})`,
                file_id: file.id, chunk_index: chunk.chunk_index, objectKey
            });

            if (!DRY_RUN) {
                await uploadToObsideo(sourcePath, objectKey);
                await sql`UPDATE file_chunks SET obsideo_key = ${objectKey} WHERE id = ${chunk.id}`;
            }

        } finally {
            cleanupTmp(tmpPath);
        }
    }

    const status = allMigrated ? 'migrated' : 'broken';
    log(DRY_RUN ? 'dry' : 'info', { msg: `Chunked file result: ${status}`, file_id: file.id });

    if (!DRY_RUN) {
        await sql`
            UPDATE files
            SET storage_provider = ${allMigrated ? 'obsideo' : 'jackal'},
                migration_status = ${status}
            WHERE id = ${file.id}
        `;
    }

    return status;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    log('info', { msg: DRY_RUN ? '=== DRY RUN — no changes will be made ===' : '=== Starting Jackal → Obsideo migration ===' });

    const sql = postgres(process.env.DATABASE_URL!);

    try {
        // Initialise Obsideo client early (fails fast if credentials are wrong)
        if (!DRY_RUN) await getObsideo();

        // Fetch all un-migrated Jackal files
        const filesToMigrate = await sql`
            SELECT id, is_chunked, jackal_fid, merkle_hash, encrypted_file_path
            FROM files
            WHERE (jackal_fid IS NOT NULL OR is_chunked = 1)
              AND migration_status IS NULL
            ORDER BY id ASC
        `;

        log('info', { msg: `Found ${filesToMigrate.length} files to migrate` });

        if (filesToMigrate.length === 0) {
            log('info', { msg: 'Nothing to do. All files already migrated.' });
            return;
        }

        // Process CONCURRENCY files at a time
        let migrated = 0, broken = 0;

        for (let i = 0; i < filesToMigrate.length; i += CONCURRENCY) {
            const batch = filesToMigrate.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map(async (file: any) => {
                log('info', { msg: `Processing file`, file_id: file.id, is_chunked: !!file.is_chunked });
                const result = file.is_chunked
                    ? await migrateChunkedFile(sql, file)
                    : await migrateFile(sql, file);
                return result;
            }));

            for (const r of results) {
                if (r === 'migrated') migrated++;
                else broken++;
            }

            log('info', { msg: `Progress: ${i + batch.length}/${filesToMigrate.length} processed`, migrated, broken });
        }

        log('info', {
            msg: '=== Migration complete ===',
            total: filesToMigrate.length,
            migrated,
            broken,
            dry_run: DRY_RUN
        });

        if (broken > 0) {
            log('warn', {
                msg: `${broken} files could not be migrated (no local cache and no Jackal merkle). They are marked 'broken' in the DB and remain inaccessible.`,
            });
        }

    } finally {
        await sql.end();
    }
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
