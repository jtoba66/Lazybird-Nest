import { db } from '../db';
import { files, folders } from '../db/schema';
import { eq, isNotNull, isNull, and } from 'drizzle-orm';
import logger from '../utils/logger';

/**
 * Migration script: Part B of "Folder Delete Leaves Ghost Files" fix.
 * Finds all files where folderId points to a folder with deleted_at IS NOT NULL
 * and files.deleted_at IS NULL, then sets deleted_at and purge_after on those files.
 */
async function main() {
    try {
        logger.info('[MIGRATION] Starting cleanup of ghost files...');

        // Perform a query joining files and folders
        const ghostFiles = await db.select({
            fileId: files.id,
            folderId: folders.id,
            userId: files.userId
        })
        .from(files)
        .innerJoin(folders, eq(files.folderId, folders.id))
        .where(and(
            isNotNull(folders.deleted_at),
            isNull(files.deleted_at)
        ));

        if (ghostFiles.length === 0) {
            logger.info('[MIGRATION] No ghost files found. Database is clean.');
            process.exit(0);
        }

        logger.info(`[MIGRATION] Found ${ghostFiles.length} ghost files. Updating...`);

        const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        let updatedCount = 0;

        // Update them in batches or individually
        for (const ghost of ghostFiles) {
            await db.update(files)
                .set({ deleted_at: new Date(), purge_after: purgeAfter })
                .where(eq(files.id, ghost.fileId));
            
            updatedCount++;
            if (updatedCount % 50 === 0) {
                logger.info(`[MIGRATION] Updated ${updatedCount}/${ghostFiles.length} files...`);
            }
        }

        logger.info(`[MIGRATION] Successfully cleaned up ${updatedCount} ghost files.`);
        process.exit(0);
    } catch (error) {
        logger.error('[MIGRATION] ❌ Failed to cleanup ghost files:', error);
        process.exit(1);
    }
}

main();
