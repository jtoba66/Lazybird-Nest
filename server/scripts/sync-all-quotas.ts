
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users, files } from '../src/db/schema';
import { eq, sql, and, isNotNull, isNull, ne } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nest_db';
const client = postgres(connectionString);
const db = drizzle(client);

async function syncAllQuotas() {
    console.log('Starting global storage quota synchronization...');

    // 1. Get all users
    const allUsers = await db.select().from(users);
    console.log(`Found ${allUsers.length} users to scan.`);

    let fixedCount = 0;
    const errors: string[] = [];

    for (const user of allUsers) {
        try {
            // Calculate Active Files usage
            const activeFiles = await db.select({
                totalSize: sql<number>`sum(${files.file_size})`
            })
                .from(files)
                .where(and(eq(files.userId, user.id), isNull(files.deleted_at)));

            // Calculate Trash Files usage (Soft Deleted)
            const trashFiles = await db.select({
                totalSize: sql<number>`sum(${files.file_size})`
            })
                .from(files)
                .where(and(eq(files.userId, user.id), isNotNull(files.deleted_at)));

            const calculatedTotal = Number(activeFiles[0].totalSize || 0) + Number(trashFiles[0].totalSize || 0);
            const currentUsage = Number(user.storage_used_bytes || 0);

            // Allow for small floating point differences if needed, but here we expect exact byte match
            if (calculatedTotal !== currentUsage) {
                console.log(`[FIX] User ${user.email} (ID: ${user.id}) - Reported: ${currentUsage}, Actual: ${calculatedTotal}. Fixing...`);

                await db.update(users)
                    .set({ storage_used_bytes: calculatedTotal })
                    .where(eq(users.id, user.id));

                fixedCount++;
            }
        } catch (err: any) {
            console.error(`[ERROR] Failed to process user ${user.id}:`, err);
            errors.push(`User ${user.id}: ${err.message}`);
        }
    }

    console.log('\n--- Synchronization Complete ---');
    console.log(`Scanned: ${allUsers.length}`);
    console.log(`Fixed: ${fixedCount}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
        console.log('Error details:', errors);
        process.exit(1);
    }
    process.exit(0);
}

syncAllQuotas();
