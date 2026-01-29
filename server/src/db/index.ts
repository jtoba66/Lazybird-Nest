import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment variables');
}

// Disable prefetch as it is not supported for "Transaction" mode in Supabase (if using pooling)
// However, for direct connection, we can use default settings.
const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });

console.log('[Database] PostgreSQL connection initialized via Drizzle');

export default db;
