import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import obsideoProvider from './storage/obsideoProvider';

async function run() {
    const fileSizeMB = 1200; // 1.2 GB
    const filePath = path.join(__dirname, '../../uploads/test_upload_1.2gb.tmp');
    const objectKey = `test_uploads/speed_test_${Date.now()}`;

    console.log(`Generating a ${fileSizeMB}MB dummy file at ${filePath}...`);
    
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    // Generate a 1.2GB file using a stream with random bytes to mimic ciphertext entropy
    const writeStream = fs.createWriteStream(filePath);
    const chunkSize = 1024 * 1024; // 1MB chunk
    
    for (let i = 0; i < fileSizeMB; i++) {
        writeStream.write(crypto.randomBytes(chunkSize));
    }
    writeStream.end();
    
    await new Promise<void>((resolve) => writeStream.on('finish', () => resolve()));
    console.log(`File generation complete. Starting upload to Obsideo as ${objectKey}...`);

    try {
        const start = performance.now();
        
        // This will call fs.promises.readFile internally in obsideoProvider.ts
        // which might use a lot of RAM, but we'll see if it survives.
        const result = await obsideoProvider.upload(filePath, objectKey);
        
        const end = performance.now();
        const totalTime = end - start;
        const speedMBps = fileSizeMB / (totalTime / 1000);

        console.log(`\n=== UPLOAD COMPLETE ===`);
        console.log(`Merkle Root / ID: ${result.merkle_root || result.id}`);
        console.log(`Total Upload Time: ${(totalTime / 1000).toFixed(2)} seconds`);
        console.log(`Average Upload Speed: ${speedMBps.toFixed(2)} MB/s`);
    } catch (err) {
        console.error('\n❌ Upload Failed:', err);
    } finally {
        // Clean up the dummy file
        if (fs.existsSync(filePath)) {
            console.log('\nCleaning up dummy file...');
            fs.unlinkSync(filePath);
        }
    }
}

run().catch(console.error);
