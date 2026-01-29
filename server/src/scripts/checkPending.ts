
import db from '../db';

try {
    console.log('--- Database Check ---');

    const pendingFiles = db.prepare(`
        SELECT count(*) as count FROM files 
        WHERE is_chunked = 0 
          AND deleted_at IS NULL 
          AND merkle_hash IS NULL 
          AND encrypted_file_path IS NOT NULL
    `).get() as any;

    console.log(`Pending Files (Monolithic): ${pendingFiles.count}`);

    const pendingChunks = db.prepare(`
        SELECT count(*) as count FROM file_chunks 
        WHERE jackal_merkle IS NULL 
          AND local_path IS NOT NULL
    `).get() as any;

    console.log(`Pending Chunks: ${pendingChunks.count}`);

    const orphanedFiles = db.prepare(`
        SELECT count(*) as count FROM files 
        WHERE user_id NOT IN (SELECT id FROM users)
    `).get() as any;

    console.log(`Orphaned Files (No User): ${orphanedFiles.count}`);

    if (pendingFiles.count > 0 || pendingChunks.count > 0 || orphanedFiles.count > 0) {
        console.log('--- Cleaning Up ---');

        // delete orphaned
        const delOrphaned = db.prepare('DELETE FROM files WHERE user_id NOT IN (SELECT id FROM users)').run();
        console.log(`Deleted ${delOrphaned.changes} orphaned files.`);

        // delete pending monolithic
        const delFiles = db.prepare(`
            DELETE FROM files 
            WHERE is_chunked = 0 
              AND deleted_at IS NULL 
              AND merkle_hash IS NULL 
              AND encrypted_file_path IS NOT NULL
        `).run();
        console.log(`Deleted ${delFiles.changes} pending monolithic files.`);

        // delete pending chunks
        // (This might cascadingly delete from file_chunks if FK exists, but lets be safe)
        const delChunks = db.prepare(`
            DELETE FROM file_chunks 
            WHERE jackal_merkle IS NULL 
              AND local_path IS NOT NULL
        `).run();
        console.log(`Deleted ${delChunks.changes} pending chunks.`);

        // Also delete parent files of pending chunks if they are also stuck?
        // Maybe too aggressive. The user said "wiped users", so mostly we care about orphaned stuff or stuff from "last ZK upgrade".
    } else {
        console.log('Queue is clean. No pending uploads found.');
    }

} catch (err: any) {
    console.error('Error:', err.message);
}
