import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(__dirname, '../../nest.db');
const db = new Database(dbPath);

console.log('--- RECALCULATING STORAGE QUOTAS ---');

try {
    const users = db.prepare('SELECT id, email, storage_used_bytes FROM users').all() as any[];

    for (const user of users) {
        // Sum up all non-deleted files for this user
        // We EXCLUDE files with jackal_fid = 'pending-chunks' because they aren't complete
        const stats = db.prepare(`
            SELECT SUM(file_size) as total_size 
            FROM files 
            WHERE user_id = ? AND deleted_at IS NULL AND jackal_fid != 'pending-chunks'
        `).get(user.id) as any;

        const actualUsed = stats.total_size || 0;

        if (actualUsed !== user.storage_used_bytes) {
            console.log(`User ${user.email} (ID: ${user.id}):`);
            console.log(`  Current: ${user.storage_used_bytes} bytes`);
            console.log(`  Actual:  ${actualUsed} bytes`);
            console.log(`  Difference: ${user.storage_used_bytes - actualUsed} bytes reclaimed.`);

            db.prepare('UPDATE users SET storage_used_bytes = ? WHERE id = ?').run(actualUsed, user.id);
            console.log('  ✅ Updated.');
        } else {
            console.log(`User ${user.email} is already accurate.`);
        }
    }

    console.log('--- DONE ---');
} catch (error) {
    console.error('Failed to recalculate storage:', error);
} finally {
    db.close();
}
