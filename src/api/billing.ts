import api from '../lib/api';

export interface SubscriptionStatus {
    tier: string;
    status: string;
    expiresAt: string | null;
    trialEndsAt: string | null;
    isGrandfathered: boolean;
    isGodMode: boolean;
    canManageBilling: boolean;
}

export const billingAPI = {
    async createCheckoutSession(): Promise<{ url: string; sessionId: string }> {
        const { data } = await api.post('/billing/create-checkout-session');
        return data;
    },

    async createPortalSession(): Promise<{ url: string }> {
        const { data } = await api.post('/billing/create-portal-session');
        return data;
    },

    async syncSubscription(sessionId: string): Promise<any> {
        const { data } = await api.post('/billing/sync-subscription', { sessionId });
        return data;
    },

    async getSubscriptionStatus(): Promise<SubscriptionStatus> {
        const { data } = await api.get('/billing/subscription');
        return data;
    }
};
