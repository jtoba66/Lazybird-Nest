import db from '../db';
import { bufferToBase64 } from '../crypto/keyManagement';

try {
    console.log('--- Checking Folder Key Length for User 4 ---');
    const folder = db.prepare('SELECT id, folder_key_encrypted, folder_key_nonce FROM folders WHERE user_id = 4 AND parent_id IS NULL').get() as any;

    if (!folder) {
        console.log('No root folder found!');
        process.exit(1);
    }

    console.log('Folder ID:', folder.id);
    console.log('Key (Buffer):', folder.folder_key_encrypted);
    console.log('Key Length (bytes):', folder.folder_key_encrypted.length);
    console.log('Key (Base64):', bufferToBase64(folder.folder_key_encrypted));
    console.log('Nonce Length (bytes):', folder.folder_key_nonce.length);

    console.log('\nExpected: XChaCha20-Poly1305 encrypted key should be 32 (plaintext) + 16 (MAC) = 48 bytes');
    console.log('Actual:', folder.folder_key_encrypted.length, 'bytes');

} catch (err: any) {
    console.error('Error:', err.message);
}
