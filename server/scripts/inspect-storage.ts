
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users, files } from '../src/db/schema';
import { eq, sql, and, isNotNull, isNull } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nest_db';
const client = postgres(connectionString);
const db = drizzle(client);

async function inspectUser(email: string) {
    console.log(`Inspecting storage for: ${email}`);

    const user = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || user.length === 0) {
        console.error('User not found');
        process.exit(1);
    }

    const userId = user[0].id;
    console.log(`User ID: ${userId}`);
    console.log(`Reported Usage: ${(user[0].storage_used_bytes / (1024 * 1024 * 1024)).toFixed(2)} GB (${user[0].storage_used_bytes} bytes)`);

    // 1. Calculate Active Files usage
    const activeFiles = await db.select({
        count: sql<number>`count(*)`,
        totalSize: sql<number>`sum(${files.file_size})`
    })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deleted_at)));

    console.log('\n--- Active Files (Visible) ---');
    console.log(`Count: ${activeFiles[0].count}`);
    console.log(`Total Size: ${(Number(activeFiles[0].totalSize || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB`);

    // 2. Calculate Trash Files usage (Soft Deleted)
    const trashFiles = await db.select({
        count: sql<number>`count(*)`,
        totalSize: sql<number>`sum(${files.file_size})`
    })
        .from(files)
        .where(and(eq(files.userId, userId), isNotNull(files.deleted_at)));

    console.log('\n--- Trash Files (In Trash Bin) ---');
    console.log(`Count: ${trashFiles[0].count}`);
    console.log(`Total Size: ${(Number(trashFiles[0].totalSize || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB`);

    // 3. Check for discrepancies
    const calculatedTotal = Number(activeFiles[0].totalSize || 0) + Number(trashFiles[0].totalSize || 0);
    const difference = user[0].storage_used_bytes - calculatedTotal;

    console.log('\n--- Analysis ---');
    console.log(`Calculated Total (Active + Trash): ${(calculatedTotal / (1024 * 1024 * 1024)).toFixed(2)} GB`);
    console.log(`Discrepancy: ${(difference / (1024 * 1024)).toFixed(2)} MB`);

    if (difference !== 0) {
        console.log('\n[!] Discrepancy detected. The user row `storage_used_bytes` might be out of sync with the actual files table.');
        console.log('Run with --fix to recalculate and update.');
    }

    if (process.argv.includes('--fix')) {
        console.log('\nFixing storage usage...');
        await db.update(users)
            .set({ storage_used_bytes: calculatedTotal })
            .where(eq(users.id, userId));
        console.log('Updated user storage usage to match calculated total.');
    }

    process.exit(0);
}

const email = process.argv[2];
if (!email) {
    console.error('Usage: npx tsx inspect-storage.ts <email> [--fix]');
    process.exit(1);
}

inspectUser(email);
