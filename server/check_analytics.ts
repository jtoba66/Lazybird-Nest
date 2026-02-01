import { db } from './src/db';
import { analyticsEvents } from './src/db/schema';
import { sql } from 'drizzle-orm';

async function check() {
    try {
        const events = await db.select().from(analyticsEvents).limit(20);
        console.log('ANALYTICS EVENTS (First 20):');
        console.log(JSON.stringify(events, null, 2));

        const count = await db.select({ count: sql`count(*)` }).from(analyticsEvents);
        console.log('TOTAL COUNT:', count[0].count);

        const groupByType = await db.select({
            type: analyticsEvents.type,
            count: sql`count(*)`
        }).from(analyticsEvents).groupBy(analyticsEvents.type);
        console.log('BY TYPE:', groupByType);
    } catch (e) {
        console.error(e);
    }
}

check();
