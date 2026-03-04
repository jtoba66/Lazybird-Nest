require('dotenv').config();
const { db } = require('./dist/db/db');
const { files } = require('./dist/db/schema');
const { desc } = require('drizzle-orm');
const sodium = require('libsodium-wrappers');
const fs = require('fs');

async function run() {
    await sodium.ready;
    const recentFiles = await db.select().from(files).orderBy(desc(files.id)).limit(20);
    const file = recentFiles.find((f) => f.share_token && f.encrypted_file_path && fs.existsSync(f.encrypted_file_path));
    if (!file) return;

    const fileKeyEncrypted = file.file_key_encrypted;
    const fileKeyNonce = file.file_key_nonce;

    if (fileKeyEncrypted.length === 32 && fileKeyNonce.length === 24 && fileKeyNonce.every((b) => b === 0)) {
        console.log("FileGrid plaintext key detected");
        const rawKey = fileKeyEncrypted;
        const fileKeyBase64 = sodium.to_base64(rawKey, sodium.base64_variants.ORIGINAL);
        const parsedKeyStr = fileKeyBase64.replace(/ /g, '+');
        const parsedKey = sodium.from_base64(parsedKeyStr, sodium.base64_variants.ORIGINAL);

        const ciphertext = fs.readFileSync(file.encrypted_file_path);
        const header = ciphertext.slice(0, 24);
        try {
            const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, parsedKey);
            console.log("Init Pull Succeeded");
            const chunk = ciphertext.slice(24);
            const { message, tag } = sodium.crypto_secretstream_xchacha20poly1305_pull(state, chunk);
            console.log("Pull succeeded");
        } catch (e) {
            console.error("Decryption failed:", e.message);
        }
    }
}
run();
