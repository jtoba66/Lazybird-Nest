import { App, cert, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { Messaging, getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env';
import logger from '../utils/logger';

let bootstrapAttempted = false;
let bootstrapFailed = false;

function parseServiceAccount(): ServiceAccount | null {
    if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as Record<string, string>;
            const serviceAccount: ServiceAccount = {
                projectId: parsed.projectId || parsed.project_id,
                clientEmail: parsed.clientEmail || parsed.client_email,
                privateKey: (parsed.privateKey || parsed.private_key || '').replace(/\\n/g, '\n'),
            };

            if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
                logger.error('[FCM] FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields');
                bootstrapFailed = true;
                return null;
            }

            return serviceAccount;
        } catch (error) {
            logger.error('[FCM] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON', error);
            bootstrapFailed = true;
            return null;
        }
    }

    if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
        return {
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        };
    }

    return null;
}

function getFirebaseApp(): App | null {
    if (getApps().length > 0) {
        return getApps()[0]!;
    }

    if (bootstrapFailed) {
        return null;
    }

    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
        if (!bootstrapAttempted) {
            logger.info('[FCM] Firebase Admin credentials not configured. Push delivery is disabled.');
        }
        bootstrapAttempted = true;
        return null;
    }

    try {
        const app = initializeApp({
            credential: cert(serviceAccount),
            projectId: serviceAccount.projectId,
        });
        bootstrapAttempted = true;
        logger.info('[FCM] Firebase Admin initialized');
        return app;
    } catch (error) {
        bootstrapFailed = true;
        logger.error('[FCM] Failed to initialize Firebase Admin', error);
        return null;
    }
}

export function isFirebaseMessagingConfigured(): boolean {
    return getFirebaseApp() !== null;
}

export function getFirebaseMessagingClient(): Messaging | null {
    const app = getFirebaseApp();
    if (!app) {
        return null;
    }
    return getMessaging(app);
}
