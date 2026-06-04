import { db } from './db';
import { fileChunks, files } from './db/schema';
import obsideoProvider from './storage/obsideoProvider';
import { eq } from 'drizzle-orm';
import { performance } from 'perf_hooks';
import { Writable } from 'stream';

async function run() {
    const objectKey = 'test_uploads/speed_test_1780587002973';
    console.log(`Using hardcoded 1.2GB file key: ${objectKey}`);
    
    const start = performance.now();
    const stream = await obsideoProvider.getStream!(objectKey);
    const ttfb = performance.now() - start;
    console.log(`Time to get stream object (Metadata + Headers): ${ttfb.toFixed(2)}ms`);

    if (!stream) {
        console.log('Stream is null');
        process.exit(1);
    }

    let bytes = 0;
    let firstByteTime = 0;
    let lastLogBytes = 0;
    
    stream.on('data', (chunk) => {
        if (bytes === 0) {
            firstByteTime = performance.now() - start;
            console.log(`Time to First Byte (Data): ${firstByteTime.toFixed(2)}ms`);
        }
        bytes += chunk.length;
        
        if (bytes - lastLogBytes > 10 * 1024 * 1024) {
            console.log(`Downloaded ${(bytes / 1024 / 1024).toFixed(2)} MB...`);
            lastLogBytes = bytes;
        }
    });

    stream.on('end', () => {
        const totalTime = performance.now() - start;
        console.log(`Total Download Time: ${totalTime.toFixed(2)}ms for ${(bytes / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Speed: ${((bytes / 1024 / 1024) / (totalTime / 1000)).toFixed(2)} MB/s`);
        process.exit(0);
    });

    stream.on('error', (err) => {
        console.error('Stream Error:', err);
        process.exit(1);
    });
}

run().catch(console.error);
