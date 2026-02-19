import { db } from './db';
import { files, fileChunks } from './db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';

async function main() {
    const ids = [100, 98, 92, 88];
    console.log('--- DIAGNOSTIC START ---');
    for (const id of ids) {
        console.log('\nChecking File ID:', id);
        const [file] = await db.select().from(files).where(eq(files.id, id));

        if (!file) {
            console.log('❌ NOT FOUND');
            continue;
        }

        console.log('✅ Found:');
        console.log('  Filename:', file.filename);
        console.log('  MIME:', file.mime_type);
        console.log('  Size:', file.file_size);
        console.log('  Is Chunked:', file.is_chunked);
        console.log('  Jackal FID:', file.jackal_fid);
        console.log('  Jackal Filename:', file.jackal_filename);
        console.log('  Local Path:', file.encrypted_file_path);

        if (file.encrypted_file_path) {
            console.log('  Path Exists:', fs.existsSync(file.encrypted_file_path));
        } else {
            console.log('  Path is NULL');
        }

        if (file.is_chunked) {
            const chunks = await db.select().from(fileChunks).where(eq(fileChunks.fileId, id));
            console.log('  Chunks Count:', chunks.length);
            chunks.forEach(c => {
                console.log('    - Chunk', c.chunk_index, 'Local:', c.local_path, '(Exists:', c.local_path ? fs.existsSync(c.local_path) : 'N/A', ') Jackal:', c.jackal_merkle);
            });
        }
    }
    console.log('\n--- DIAGNOSTIC END ---');
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
