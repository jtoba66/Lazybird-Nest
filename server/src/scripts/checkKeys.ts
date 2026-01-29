
import { db } from '../db';
import { sql } from 'drizzle-orm';

(async () => {
    try {
        console.log('--- Checking Folders for User 4 ---');
        const folders = await db.execute(sql`SELECT id, parent_id, folder_key_encrypted FROM folders WHERE user_id = 4`);

        console.table(folders);

        if (folders.length === 0) {
            console.log('No folders found for user 4!');
        }
        process.exit(0);
    } catch (err: any) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
