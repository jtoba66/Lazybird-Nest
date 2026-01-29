
import db from '../db';

try {
    console.log('--- Checking Folders for User 4 ---');
    const folders = db.prepare('SELECT id, parent_id, folder_key_encrypted FROM folders WHERE user_id = 4').all() as any[];

    console.table(folders);

    if (folders.length === 0) {
        console.log('No folders found for user 4!');
    }
} catch (err: any) {
    console.error('Error:', err.message);
}
