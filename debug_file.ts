
import { db } from './server/src/db';
import { files, fileChunks } from './server/src/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';

async function main() {
    console.log("Checking File ID 6...");
    const [file] = await db.select().from(files).where(eq(files.id, 6));

    if (!file) {
        console.log("❌ File 6 NOT FOUND in DB.");
        process.exit(0);
    }

    console.log("✅ File 6 Found:");
    console.log(JSON.stringify(file, null, 2));

    if (file.encrypted_file_path) {
        console.log(`Local Path Exists: ${fs.existsSync(file.encrypted_file_path)}`);
    }

    if (file.is_chunked) {
        const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, 6));
        console.log(`Chunks Found: ${chunks.length}`);
        chunks.forEach(c => {
            console.log(`- Chunk ${c.chunk_index}: Local=${c.local_path} (Exists: ${c.local_path ? fs.existsSync(c.local_path) : 'N/A'}), Merkle=${c.jackal_merkle}`);
        });
    }
    process.exit(0);
}

main().catch(console.error);
