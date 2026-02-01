import 'dotenv/config';
import { db } from '../db';
import { userCrypto } from '../db/schema';
import { sql } from 'drizzle-orm';

async function verifyMigration() {
    try {
        console.log('[Verify] Checking user_crypto table structure...');

        // Try fetching a user_crypto record to see what columns exist
        const records = await db.select().from(userCrypto).limit(1);

        console.log('Sample record from user_crypto:');
        if (records.length > 0) {
            console.log('Column names:', Object.keys(records[0]));

            if ('metadata_version' in records[0]) {
                console.log('✅ [Verify] metadata_version column EXISTS!');
                console.log('Value:', records[0].metadata_version);
            } else {
                console.log('❌ [Verify] metadata_version column NOT FOUND in record');
            }
        } else {
            console.log('No records found in user_crypto table (table might be empty)');

            // Try direct SQL query
            const rawResult: any = await db.execute(sql`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'user_crypto' 
                ORDER BY ordinal_position
            `);

            console.log('\nDirect SQL query result:');
            console.log(rawResult);
        }

        process.exit(0);
    } catch (error: any) {
        console.error('❌ [Verify] Failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

verifyMigration();
