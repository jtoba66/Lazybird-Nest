import { db } from '../db';
import { files as filesTable } from '../db/schema';
import { eq, and, isNull, sql, isNotNull, ne } from 'drizzle-orm';
import fs from 'fs';
import { verifyFile } from '../storage';

const BATCH_SIZE = 50;
const JOB_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function startVerificationJob() {
    console.log('[VerificationJob] Starting background verification service...');
    runVerificationCycle();
    setInterval(runVerificationCycle, JOB_INTERVAL_MS);
}

async function runVerificationCycle() {
    console.log('[VerificationJob] Running verification cycle...');

    try {
        const filesToCheck = await db.select({
            id: filesTable.id,
            jackal_filename: filesTable.jackal_filename,
            merkle_hash: filesTable.merkle_hash,
            obsideo_key: filesTable.obsideo_key,
            storage_provider: filesTable.storage_provider,
            encrypted_file_path: filesTable.encrypted_file_path
        })
            .from(filesTable)
            .where(and(
                eq(filesTable.is_gateway_verified, 0),
                isNotNull(filesTable.merkle_hash),
                ne(filesTable.merkle_hash, ''),
                ne(filesTable.jackal_fid, 'pending'),
                isNotNull(filesTable.encrypted_file_path),
                isNull(filesTable.deleted_at)
            ))
            .limit(BATCH_SIZE);

        if (filesToCheck.length === 0) {
            console.log('[VerificationJob] No pending files to verify.');
            return;
        }

        console.log(`[VerificationJob] Found ${filesToCheck.length} files to check.`);

        for (const file of filesToCheck) {
            try {
                const storageKey = file.obsideo_key || file.merkle_hash;
                if (!storageKey) continue;
                
                const verified = await verifyFile(storageKey, file.storage_provider);

                if (verified) {
                    console.log(`[VerificationJob] ✅ File verified: ${file.jackal_filename} (ID: ${file.id})`);

                    await db.update(filesTable)
                        .set({ is_gateway_verified: 1, encrypted_file_path: null })
                        .where(eq(filesTable.id, file.id));

                    if (file.encrypted_file_path && fs.existsSync(file.encrypted_file_path)) {
                        fs.unlinkSync(file.encrypted_file_path);
                        console.log(`[VerificationJob] 🗑️ Deleted local copy: ${file.encrypted_file_path}`);
                    }
                }
            } catch (err) {
                console.error(`[VerificationJob] Error processing file ID ${file.id}:`, err);
            }
        }
    } catch (err) {
        console.error('[VerificationJob] Job failed:', err);
    }
}
