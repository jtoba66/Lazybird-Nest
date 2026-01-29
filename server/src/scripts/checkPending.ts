
import { db } from '../db';
import { sql } from 'drizzle-orm';

(async () => {
    try {
        console.log('--- Database Check ---');

        const pendingFiles = (await db.execute(sql`
            SELECT count(*) as count FROM files 
            WHERE is_chunked = 0 
              AND deleted_at IS NULL 
              AND merkle_hash IS NULL 
              AND encrypted_file_path IS NOT NULL
        `))[0] as any;

        console.log(`Pending Files (Monolithic): ${pendingFiles.count}`);

        const pendingChunks = (await db.execute(sql`
            SELECT count(*) as count FROM file_chunks 
            WHERE jackal_merkle IS NULL 
              AND local_path IS NOT NULL
        `))[0] as any;

        console.log(`Pending Chunks: ${pendingChunks.count}`);

        const orphanedFiles = (await db.execute(sql`
            SELECT count(*) as count FROM files 
            WHERE user_id NOT IN (SELECT id FROM users)
        `))[0] as any;

        console.log(`Orphaned Files (No User): ${orphanedFiles.count}`);

        if (Number(pendingFiles.count) > 0 || Number(pendingChunks.count) > 0 || Number(orphanedFiles.count) > 0) {
            console.log('--- Cleaning Up ---');

            // delete orphaned
            const delOrphaned = await db.execute(sql`DELETE FROM files WHERE user_id NOT IN (SELECT id FROM users)`);
            console.log(`Deleted orphaned files.`);

            // delete pending monolithic
            const delFiles = await db.execute(sql`
                DELETE FROM files 
                WHERE is_chunked = 0 
                  AND deleted_at IS NULL 
                  AND merkle_hash IS NULL 
                  AND encrypted_file_path IS NOT NULL
            `);
            console.log(`Deleted pending monolithic files.`);

            // delete pending chunks
            const delChunks = await db.execute(sql`
                DELETE FROM file_chunks 
                WHERE jackal_merkle IS NULL 
                  AND local_path IS NOT NULL
            `);
            console.log(`Deleted pending chunks.`);

        } else {
            console.log('Queue is clean. No pending uploads found.');
        }
        process.exit(0);

    } catch (err: any) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
