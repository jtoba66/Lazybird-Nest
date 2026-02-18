
import { db } from '../src/db';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function checkUser() {
    const email = 'josephtoba27@gmail.com';
    const user = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (user.length === 0) {
        console.log('User not found');
    } else {
        console.log('User found:', {
            id: user[0].id,
            email: user[0].email,
            subscription_tier: user[0].subscription_tier,
            stripe_customer_id: user[0].stripe_customer_id,
            isAdmin: user[0].role === 'admin'
        });
    }
    process.exit(0);
}

checkUser();
