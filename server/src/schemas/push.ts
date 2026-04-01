import { z } from 'zod';

const pushCategorySchema = z.enum(['transfer', 'share', 'security', 'account']);

export const registerPushTokenSchema = z.object({
    body: z.object({
        token: z.string().min(32),
        platform: z.enum(['android']).default('android'),
        deviceId: z.string().max(200).optional(),
        deviceLabel: z.string().max(200).optional(),
        appVersion: z.string().max(80).optional(),
    })
});

export const unregisterPushTokenSchema = z.object({
    body: z.object({
        token: z.string().min(32),
    })
});

export const sendTestPushSchema = z.object({
    body: z.object({
        category: pushCategorySchema.default('transfer'),
        title: z.string().min(1).max(120).optional(),
        body: z.string().min(1).max(500).optional(),
    })
});

export type PushCategory = z.infer<typeof pushCategorySchema>;
