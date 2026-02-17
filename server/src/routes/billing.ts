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
    sendPaymentFailedEmail,
    sendPaymentReceivedEmail,
    sendCancellationFarewellEmail
} from '../services/email';

const router = express.Router();

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-11-20.acacia' as any,
    typescript: true
});

let FRONTEND_URL = env.FRONTEND_URL.split(',')[0].trim();

if (env.NODE_ENV === 'production' && FRONTEND_URL.includes('localhost')) {
    console.warn('[Billing] FRONTEND_URL is localhost in production. Defaulting to https://nest.lazybird.io');
    FRONTEND_URL = 'https://nest.lazybird.io';
}

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

        // Dynamically determine return base URL from request headers if possible
        let returnBaseUrl = FRONTEND_URL;
        const origin = req.get('origin');
        const referer = req.get('referer');

        if (origin && (origin.includes('lazybird.io') || origin.includes('localhost'))) {
            returnBaseUrl = origin;
        } else if (referer && (referer.includes('lazybird.io') || referer.includes('localhost'))) {
            try {
                const url = new URL(referer);
                returnBaseUrl = url.origin;
            } catch (e) { /* ignore */ }
        }

        if (env.NODE_ENV === 'production' && returnBaseUrl.includes('localhost')) {
            returnBaseUrl = 'https://nest.lazybird.io';
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
            success_url: `${returnBaseUrl}/settings?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${returnBaseUrl}/pricing?upgrade=canceled`,
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

        // Dynamically determine return base URL from request headers if possible
        let returnBaseUrl = FRONTEND_URL;
        const origin = req.get('origin');
        const referer = req.get('referer');

        if (origin && (origin.includes('lazybird.io') || origin.includes('localhost'))) {
            returnBaseUrl = origin;
            logger.info(`[BILLING] Using Origin for return_url: ${returnBaseUrl}`);
        } else if (referer && (referer.includes('lazybird.io') || referer.includes('localhost'))) {
            try {
                // If referer is present, extract origin
                const url = new URL(referer);
                returnBaseUrl = url.origin;
                logger.info(`[BILLING] Using Referer for return_url: ${returnBaseUrl}`);
            } catch (e) {
                /* ignore invalid referer */
            }
        }

        // Final sanity check: if running in production but still pointing to localhost, force prod domain
        if (env.NODE_ENV === 'production' && returnBaseUrl.includes('localhost')) {
            returnBaseUrl = 'https://nest.lazybird.io';
            logger.warn('[BILLING] Forced return_url to production domain due to localhost config');
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer_id,
            return_url: `${returnBaseUrl}/settings`
        });

        res.json({ url: session.url });
    } catch (e: any) {
        res.status(500).json({ error: 'Failed' });
    }
});

router.post('/sync-subscription', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const userId = req.user!.userId;
        const { sessionId } = req.body;

        if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

        // Race condition check: Skip if already Pro with valid subscription
        const [currentUser] = await db.select({
            subscription_tier: users.subscription_tier,
            stripe_subscription_id: users.stripe_subscription_id
        }).from(users).where(eq(users.id, userId)).limit(1);

        if (currentUser?.subscription_tier === 'pro' && currentUser?.stripe_subscription_id) {
            logger.info(`[BILLING-SYNC] User ${userId} already Pro, skipping duplicate sync`);
            return res.json({ success: true, tier: 'pro', alreadySynced: true });
        }

        // 1. Retrieve Session from Stripe to verify legitimacy
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // 2. Verify it belongs to this user and is paid
        if (session.metadata?.userId !== String(userId)) {
            return res.status(403).json({ error: 'Session does not belong to this user' });
        }

        if (session.payment_status !== 'paid') {
            return res.status(400).json({ error: 'Payment not completed' });
        }

        // 3. Update User (Mimic Webhook Logic)
        if (session.subscription) {
            const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

            // Fetch subscription details to get correct status/expiry if needed, 
            // but for 'checkout.session.completed' mimicry, we assume trialing/active start.
            // Let's fetch the subscription to be safe and accurate.
            const subscription = await stripe.subscriptions.retrieve(subId);

            await db.update(users).set({
                subscription_tier: 'pro',
                subscription_status: subscription.status,
                stripe_subscription_id: subId,
                trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
                subscription_expires_at: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000) : null,
                storage_quota_bytes: PRICING.pro.storage,
                stripe_customer_id: session.customer as string
            }).where(eq(users.id, userId));
        }

        res.json({ success: true, tier: 'pro' });

    } catch (e: any) {
        console.error('Sync subscription failed:', e);
        res.status(500).json({ error: 'Sync failed' });
    }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !webhookSecret) {
        logger.warn('[BILLING-WEBHOOK] Missing signature or webhook secret');
        return res.status(400).send('Webhook error');
    }

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
                logger.info(`[BILLING-WEBHOOK] checkout.session.completed for user ${userId}`);
                if (userId && session.subscription) {
                    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
                    // Fetch subscription to get accurate trial_end
                    const subscription = await stripe.subscriptions.retrieve(subId);
                    await db.update(users).set({
                        subscription_tier: 'pro',
                        subscription_status: subscription.status,
                        stripe_subscription_id: subId,
                        stripe_customer_id: session.customer as string,
                        trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
                        subscription_expires_at: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000) : null,
                        storage_quota_bytes: PRICING.pro.storage
                    }).where(eq(users.id, parseInt(userId)));

                    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, parseInt(userId))).limit(1);
                    if (user?.email) sendSubscriptionStartedEmail(user.email).catch(console.error);
                    logger.info(`[BILLING-WEBHOOK] User ${userId} upgraded to Pro`);
                }
                break;
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const sub = event.data.object as Stripe.Subscription;
                logger.info(`[BILLING-WEBHOOK] ${event.type} for customer ${sub.customer}`);
                const status = sub.status === 'active' ? 'active' : sub.status === 'trialing' ? 'trialing' : sub.status === 'past_due' ? 'past_due' : 'canceled';
                const expiresAt = (sub as any).current_period_end ? new Date((sub as any).current_period_end * 1000) : null;
                const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

                await db.update(users).set({
                    subscription_tier: 'pro',
                    subscription_status: status,
                    subscription_expires_at: expiresAt,
                    trial_ends_at: trialEnd,
                    stripe_subscription_id: sub.id,
                    storage_quota_bytes: PRICING.pro.storage
                }).where(eq(users.stripe_customer_id, sub.customer as string));
                logger.info(`[BILLING-WEBHOOK] Subscription updated: status=${status}`);
                break;
            }
            case 'customer.subscription.deleted': {
                const sub = event.data.object as Stripe.Subscription;
                logger.info(`[BILLING-WEBHOOK] subscription.deleted for customer ${sub.customer}`);
                const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.stripe_customer_id, sub.customer as string)).limit(1);
                if (user) {
                    await db.update(users).set({
                        subscription_tier: 'free',
                        subscription_status: 'canceled',
                        stripe_subscription_id: null,
                        storage_quota_bytes: PRICING.free.storage
                    }).where(eq(users.id, user.id));
                    if (user.email) sendCancellationFarewellEmail(user.email).catch(console.error);
                    logger.info(`[BILLING-WEBHOOK] User ${user.id} downgraded to Free`);
                }
                break;
            }
            case 'invoice.payment_succeeded': {
                const invoice = event.data.object as Stripe.Invoice;
                logger.info(`[BILLING-WEBHOOK] payment_succeeded for customer ${invoice.customer}`);
                await db.update(users).set({ subscription_status: 'active' })
                    .where(and(eq(users.stripe_customer_id, invoice.customer as string), eq(users.subscription_tier, 'pro')));

                // Send payment received email (skip initial payment - already sent subscription started)
                if (invoice.billing_reason === 'subscription_cycle') {
                    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.stripe_customer_id, invoice.customer as string)).limit(1);
                    if (user?.email) {
                        const amount = invoice.amount_paid ? `$${(invoice.amount_paid / 100).toFixed(2)}` : '$4.99';
                        sendPaymentReceivedEmail(user.email, amount).catch(console.error);
                    }
                }
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                logger.warn(`[BILLING-WEBHOOK] payment_failed for customer ${invoice.customer}`);
                const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.stripe_customer_id, invoice.customer as string)).limit(1);
                if (user) {
                    await db.update(users).set({ subscription_status: 'past_due' }).where(eq(users.id, user.id));
                    if (user.email) sendPaymentFailedEmail(user.email).catch(console.error);
                    logger.warn(`[BILLING-WEBHOOK] User ${user.id} marked as past_due`);
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
