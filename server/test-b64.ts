import * as sodium from 'libsodium-wrappers';

async function run() {
    await sodium.ready;
    console.log("Sodium ready.");

    // Simulate 32-byte key
    const originalKey = new Uint8Array(32);
    for(let i=0; i<32; i++) originalKey[i] = i;

    // NestPage logic
    const b64 = sodium.to_base64(originalKey, sodium.base64_variants.ORIGINAL);
    console.log("Base64:", b64);

    // SharePage logic
    const sanitized = b64.replace(/ /g, '+');
    const decoded = sodium.from_base64(sanitized, sodium.base64_variants.ORIGINAL);

    console.log("Original match:", Buffer.compare(originalKey, decoded) === 0);
    
    // Test with problematic characters
    const probKey = new Uint8Array(32);
    probKey[0] = 255; probKey[1] = 0; probKey[31] = 127;
    const b64Prob = sodium.to_base64(probKey, sodium.base64_variants.ORIGINAL);
    console.log("Prob Base64:", b64Prob);
    const decodedProb = sodium.from_base64(b64Prob, sodium.base64_variants.ORIGINAL);
    console.log("Prob match:", Buffer.compare(probKey, decodedProb) === 0);
}

run().catch(console.error);
