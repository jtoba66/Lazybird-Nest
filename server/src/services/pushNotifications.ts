import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { userPushTokens } from '../db/schema';
import { getFirebaseMessagingClient } from './firebaseAdmin';
import logger from '../utils/logger';
import type { PushCategory } from '../schemas/push';

type PushPlatform = 'android';

interface RegisterPushTokenInput {
    userId: number;
    token: string;
    platform?: PushPlatform;
    deviceId?: string;
    deviceLabel?: string;
    appVersion?: string;
}

interface RemovePushTokenInput {
    userId: number;
    token: string;
}

interface PushPayload {
    category: PushCategory;
    title: string;
    body: string;
    data?: Record<string, string | number | boolean | null | undefined>;
}

export interface PushSendResult {
    attempted: number;
    delivered: number;
    failed: number;
    skipped?: boolean;
    reason?: 'not_configured' | 'no_tokens';
}

const INVALID_TOKEN_ERRORS = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
]);

export async function registerPushToken(input: RegisterPushTokenInput): Promise<void> {
    const token = input.token.trim();
    const now = new Date();
    const [existing] = await db.select({
        id: userPushTokens.id,
        userId: userPushTokens.userId,
    }).from(userPushTokens).where(eq(userPushTokens.token, token)).limit(1);

    if (existing) {
        await db.update(userPushTokens).set({
            userId: input.userId,
            platform: input.platform ?? 'android',
            device_id: input.deviceId ?? null,
            device_label: input.deviceLabel ?? null,
            app_version: input.appVersion ?? null,
            last_seen_at: now,
        }).where(eq(userPushTokens.id, existing.id));
        return;
    }

    await db.insert(userPushTokens).values({
        userId: input.userId,
        token,
        platform: input.platform ?? 'android',
        device_id: input.deviceId ?? null,
        device_label: input.deviceLabel ?? null,
        app_version: input.appVersion ?? null,
        last_seen_at: now,
        created_at: now,
    });
}

export async function removePushToken(input: RemovePushTokenInput): Promise<void> {
    await db.delete(userPushTokens).where(and(
        eq(userPushTokens.userId, input.userId),
        eq(userPushTokens.token, input.token.trim())
    ));
}

export async function sendPushToUser(userId: number, payload: PushPayload): Promise<PushSendResult> {
    const messaging = getFirebaseMessagingClient();
    if (!messaging) {
        return {
            attempted: 0,
            delivered: 0,
            failed: 0,
            skipped: true,
            reason: 'not_configured',
        };
    }

    const rows = await db.select({
        id: userPushTokens.id,
        token: userPushTokens.token,
    }).from(userPushTokens).where(eq(userPushTokens.userId, userId));

    if (rows.length === 0) {
        return {
            attempted: 0,
            delivered: 0,
            failed: 0,
            skipped: true,
            reason: 'no_tokens',
        };
    }

    const message = {
        tokens: rows.map(row => row.token),
        notification: {
            title: payload.title,
            body: payload.body,
        },
        data: serializeData({
            category: payload.category,
            title: payload.title,
            body: payload.body,
            ...payload.data,
        }),
        android: {
            priority: payload.category === 'security' ? 'high' as const : 'normal' as const,
            notification: {
                channelId: categoryToChannelId(payload.category),
            }
        }
    };

    try {
        const response = await messaging.sendEachForMulticast(message);
        const invalidTokenDeletes: Promise<unknown>[] = [];

        response.responses.forEach((item: { success: boolean; error?: { code?: string } }, index: number) => {
            if (!item.success && item.error?.code && INVALID_TOKEN_ERRORS.has(item.error.code)) {
                invalidTokenDeletes.push(
                    db.delete(userPushTokens).where(eq(userPushTokens.id, rows[index]!.id))
                );
            }
        });

        await Promise.all(invalidTokenDeletes);

        if (response.failureCount > 0) {
            logger.warn(`[FCM] Push send for user ${userId} had ${response.failureCount} failures out of ${rows.length}`);
        }

        return {
            attempted: rows.length,
            delivered: response.successCount,
            failed: response.failureCount,
        };
    } catch (error) {
        logger.error(`[FCM] Push send failed for user ${userId}`, error);
        return {
            attempted: rows.length,
            delivered: 0,
            failed: rows.length,
        };
    }
}

function serializeData(data: Record<string, string | number | boolean | null | undefined>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(data)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)])
    );
}

function categoryToChannelId(category: PushCategory): string {
    switch (category) {
        case 'share':
            return 'nest_shares';
        case 'security':
            return 'nest_security';
        case 'account':
            return 'nest_account';
        case 'transfer':
        default:
            return 'nest_transfers';
    }
}
