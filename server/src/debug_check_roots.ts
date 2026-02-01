
import * as dotenv from 'dotenv';
dotenv.config();
import { db } from './db';
import { folders } from './db/schema';
import { eq } from 'drizzle-orm';

async function main() {
    console.log('--- FOLDER CHECK ---');
    const allFolders = await db.select().from(folders);
    allFolders.forEach(f => {
        // Log simpler output
        console.log(`[${f.id}] User: ${f.userId}, Parent: ${f.parentId}`);
    });
    console.log('--------------------');
    process.exit(0);
}

main().catch(console.error);
