import db from '../db';

try {
    console.log('--- Checking Metadata for User 4 ---');
    const cryptoData = db.prepare('SELECT * FROM user_crypto WHERE user_id = 4').get() as any;

    if (!cryptoData) {
        console.log('No crypto data found!');
        process.exit(1);
    }

    // Decode metadata blob
    const metadataBlob = cryptoData.metadata_blob;
    console.log('Metadata Blob (Buffer):', metadataBlob);
    console.log('Metadata Blob Length:', metadataBlob.length);

    // Try to decrypt it (we need the master key for this, which we don't have server-side in ZK)
    // So let's just check the blob size and see if it changed
    console.log('\n--- Recent Files in Database ---');
    const files = db.prepare('SELECT id, created_at FROM files WHERE user_id = 4 ORDER BY id DESC LIMIT 5').all() as any[];
    console.table(files);

} catch (err: any) {
    console.error('Error:', err.message);
}
