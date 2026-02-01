
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv'; // Still need for parsing

// Manual Load
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
    console.log(`Loading .env from ${envPath}`);
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
} else {
    console.error(`❌ .env file not found at ${envPath}`);
    process.exit(1);
}

// Mock other required env vars for validation if missing
process.env.PORT = process.env.PORT || '3001';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';

import { getJackalHandler, uploadFileToJackal } from '../jackal';

async function run() {
    console.log("Starting minimal upload test...");

    // Create dummy file
    const testFile = path.join(__dirname, 'test-upload.txt');
    fs.writeFileSync(testFile, "Hello Jackal! This is a test file to verify upload functionality.");
    console.log(`Created test file at ${testFile}`);

    try {
        console.log("Connecting to Jackal...");
        const { storage, address } = await getJackalHandler(true);
        console.log(`Connected with address: ${address}`);

        console.log("Attempting upload...");
        const result = await uploadFileToJackal(storage, testFile, 'test-upload.txt');

        console.log("Upload Result:", JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Upload Failed:", error);
    } finally {
        // Cleanup
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        process.exit(0);
    }
}

run();
