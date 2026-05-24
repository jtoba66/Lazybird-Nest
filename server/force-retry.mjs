import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Client } = pkg;
import { env } from './src/config/env.js';

// We need to use the compiled output path for the schema
// Since this is just a raw query, we can bypass the ORM schema if needed,
// but let's just run a raw query directly via the pg Client for simplicity.

async function run() {
    const client = new Client({
        connectionString: env.DATABASE_URL
    });
    
    await client.connect();
    
    console.log("Connected to DB.");
    
    // Clear last_retry_at for all pending chunks so the scheduler picks them up immediately
    const res = await client.query(`
        UPDATE file_chunks
        SET last_retry_at = NULL, retry_count = 0
        WHERE is_gateway_verified = 0 OR jackal_merkle = 'pending'
    `);
    
    console.log(`Updated ${res.rowCount} chunks.`);
    
    await client.end();
}

run().catch(console.error);
