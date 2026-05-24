import { db } from './dist/db/index.js';
import { files, fileChunks } from './dist/db/schema.js';
import { eq } from 'drizzle-orm';

async function run() {
    const chunkRows = await db.select().from(fileChunks).where(eq(fileChunks.fileId, 134));
    console.log(JSON.stringify(chunkRows, null, 2));
    
    // Also update them to retry
    await db.update(fileChunks).set({ last_retry_at: null, retry_count: 0 }).where(eq(fileChunks.fileId, 134));
    console.log("Reset retry count for file 134 chunks");
    process.exit(0);
}

run().catch(console.error);
