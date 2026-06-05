import { env } from './env';

export const PRICING = {
    free: {
        name: 'Free',
        storage: 2 * 1024 * 1024 * 1024,  // 2GB
        price: 0,
        features: [
            '2GB Storage',
            'Zero-knowledge encryption',
            'Unlimited file sharing',
            'Basic support'
        ]
    },
    pro: {
        name: 'Pro',
        storage: 100 * 1024 * 1024 * 1024,  // 100GB
        monthly: {
            price: 2.99,
            priceId: env.STRIPE_PRO_PRICE_ID || 'price_nest_pro_monthly'
        },
        yearly: {
            price: 29.99,
            priceId: env.STRIPE_PRO_YEARLY_PRICE_ID || 'price_nest_pro_yearly'
        },
        features: [
            '100GB Storage',
            'Zero-knowledge encryption',
            'Unlimited file sharing',
            'Priority support',
            'Advanced file management'
        ]
    },
    max: {
        name: 'Max',
        storage: 500 * 1024 * 1024 * 1024,  // 500GB
        monthly: {
            price: 12.99,
            priceId: env.STRIPE_MAX_MONTHLY_PRICE_ID || 'price_nest_max_monthly'
        },
        yearly: {
            price: 129.99,
            priceId: env.STRIPE_MAX_YEARLY_PRICE_ID || 'price_nest_max_yearly'
        },
        features: [
            '500GB Storage',
            'Zero-knowledge encryption',
            'Unlimited file sharing',
            'Priority support',
            'Advanced file management',
            'Large file support'
        ]
    }
};

// Storage quota by tier
export const getStorageQuota = (tier: string): number => {
    switch (tier) {
        case 'max':
            return PRICING.max.storage;
        case 'pro':
            return PRICING.pro.storage;
        case 'free':
        default:
            return PRICING.free.storage;
    }
};
