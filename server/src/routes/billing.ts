import express from 'express';
import Stripe from 'stripe';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { PRICING } from '../config/pricing';
import { env } from '../config/env';
import logger from '../utils/logger';
import {
    sendSubscriptionStartedEmail,
    sendSubscriptionCanceledEmail,
    sendPaymentFailedEmail
} from '../services/email';

const router = express.Router();

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-11-20.acacia' as any,
    typescript: true
});

const FRONTEND_URL = env.FRONTEND_URL.split(',')[0].trim();

router.post('/create-checkout-session', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const userId = req.user!.userId;
        const [user] = await db.select({
            email: users.email,
            stripe_customer_id: users.stripe_customer_id,
            subscription_tier: users.subscription_tier
        }).from(users).where(eq(users.id, userId)).limit(1);

        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.subscription_tier === 'pro' && user.stripe_customer_id &&
            !['GRANDFATHERED', 'GOD_MODE'].includes(user.stripe_customer_id)) {
            return res.status(400).json({ error: 'Already subscribed to Pro' });
        }

        let customerId = user.stripe_customer_id;
        if (['GRANDFATHERED', 'GOD_MODE'].includes(customerId || '')) {
            return res.status(400).json({ error: 'No upgrade needed' });
        }

        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: { userId: String(userId) }
            });
            customerId = customer.id;
            await db.update(users).set({ stripe_customer_id: customerId }).where(eq(users.id, userId));
        }

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: PRICING.pro.monthly.priceId, quantity: 1 }],
            subscription_data: {
                trial_period_days: 7,
                metadata: { userId: String(userId) }
            },
            success_url: `${FRONTEND_URL}/settings?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/pricing?upgrade=canceled`,
            metadata: { userId: String(userId) }
        });

        res.json({ url: session.url, sessionId: session.id });
    } catch (e: any) {
        logger.error('Checkout session error:', e);
        res.status(500).json({ error: 'Failed' });
    }
});

router.post('/create-portal-session', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const userId = req.user!.userId;
        const [user] = await db.select({ stripe_customer_id: users.stripe_customer_id }).from(users).where(eq(users.id, userId)).limit(1);

        if (!user?.stripe_customer_id || ['GRANDFATHERED', 'GOD_MODE'].includes(user.stripe_customer_id)) {
            return res.status(400).json({ error: 'No subscription found' });
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer_id,
            return_url: `${FRONTEND_URL}/settings`
        });

        res.json({ url: session.url });
    } catch (e: any) {
        res.status(500).json({ error: 'Failed' });
    }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !webhookSecret) return res.status(400).send('Webhook error');

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const userId = session.metadata?.userId;
                if (userId && session.subscription) {
                    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
                    await db.update(users).set({
                        subscription_tier: 'pro',
                        subscription_status: 'trialing',
                        stripe_subscription_id: subId,
                        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        storage_quota_bytes: PRICING.pro.storage
                    }).where(eq(users.id, parseInt(userId)));

                    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, parseInt(userId))).limit(1);
                    if (user?.email) sendSubscriptionStartedEmail(user.email).catch(console.error);
                }
                break;
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const sub = event.data.object as Stripe.Subscription;
                const status = sub.status === 'active' ? 'active' : sub.status === 'trialing' ? 'trialing' : sub.status === 'past_due' ? 'past_due' : 'canceled';
                const expiresAt = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
                const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

                await db.update(users).set({
                    subscription_tier: 'pro',
                    subscription_status: status,
                    subscription_expires_at: expiresAt,
                    trial_ends_at: trialEnd,
                    stripe_subscription_id: sub.id,
                    storage_quota_bytes: PRICING.pro.storage
                }).where(eq(users.stripe_customer_id, sub.customer as string));
                break;
            }
            case 'customer.subscription.deleted': {
                const sub = event.data.object as Stripe.Subscription;
                const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.stripe_customer_id, sub.customer as string)).limit(1);
                if (user) {
                    await db.update(users).set({
                        subscription_tier: 'free',
                        subscription_status: 'canceled',
                        stripe_subscription_id: null,
                        storage_quota_bytes: PRICING.free.storage
                    }).where(eq(users.id, user.id));
                    if (user.email) sendSubscriptionCanceledEmail(user.email).catch(console.error);
                }
                break;
            }
            case 'invoice.payment_succeeded': {
                const invoice = event.data.object as Stripe.Invoice;
                await db.update(users).set({ subscription_status: 'active' })
                    .where(and(eq(users.stripe_customer_id, invoice.customer as string), eq(users.subscription_tier, 'pro')));
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.stripe_customer_id, invoice.customer as string)).limit(1);
                if (user) {
                    await db.update(users).set({ subscription_status: 'past_due' }).where(eq(users.id, user.id));
                    if (user.email) sendPaymentFailedEmail(user.email).catch(console.error);
                }
                break;
            }
        }
        res.json({ received: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

router.get('/subscription', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const userId = req.user!.userId;
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isGrandfathered = user.stripe_customer_id === 'GRANDFATHERED';
        const isGodMode = user.stripe_customer_id === 'GOD_MODE';

        res.json({
            tier: user.subscription_tier || 'free',
            status: user.subscription_status || 'active',
            expiresAt: user.subscription_expires_at,
            trialEndsAt: user.trial_ends_at,
            isGrandfathered,
            isGodMode,
            canManageBilling: user.stripe_customer_id && !isGrandfathered && !isGodMode
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

export default router;
