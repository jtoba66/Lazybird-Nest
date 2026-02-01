import { db } from './db';
import { folders, users, files } from './db/schema';
import { eq, isNull } from 'drizzle-orm';

async function debugAll() {
    try {
        const u = await db.select().from(users);
        const f = await db.select().from(folders);
        const fl = await db.select().from(files);

        console.log('--- USERS ---');
        u.forEach(x => console.log(`ID:${x.id} E:${x.email}`));

        console.log('\n--- FOLDERS ---');
        f.forEach(x => {
            const isCircular = x.parentId === x.id;
            const isMultipleRoot = x.parentId === null;
            console.log(`ID:${x.id} U:${x.userId} P:${x.parentId} H:${x.path_hash} ${isCircular ? '!!!CIRCULAR!!!' : ''} ${isMultipleRoot ? '[ROOT]' : ''}`);
        });

        console.log('\n--- FILES ---');
        fl.forEach(x => console.log(`ID:${x.id} U:${x.userId} F:${x.folderId} N:${x.jackal_filename}`));

        // Check for users with multiple roots
        const rootsByUser = new Map<number, number>();
        f.filter(x => x.parentId === null).forEach(x => {
            rootsByUser.set(x.userId, (rootsByUser.get(x.userId) || 0) + 1);
        });

        console.log('\n--- ROOT CONSISTENCY ---');
        rootsByUser.forEach((count, uid) => {
            console.log(`User ${uid}: ${count} root folder(s) ${count > 1 ? '!!!DUPLICATE!!!' : ''}`);
        });

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

debugAll();
