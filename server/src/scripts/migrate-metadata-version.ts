import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function runMigration() {
    try {
        console.log('[Migration] Adding metadata_version column to user_crypto table...');

        await db.execute(sql`
            ALTER TABLE user_crypto 
            ADD COLUMN IF NOT EXISTS metadata_version INTEGER DEFAULT 1 NOT NULL
        `);

        console.log('✅ [Migration] Successfully added metadata_version column');
        console.log('[Migration] Migration complete!');

        process.exit(0);
    } catch (error: any) {
        console.error('❌ [Migration] Failed:', error.message);
        process.exit(1);
    }
}

runMigration();
