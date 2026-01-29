import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file for local development
dotenv.config({ path: path.join(__dirname, '../../.env') });

const envSchema = z.object({
    // Server
    PORT: z.string().default('3001').transform(Number),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Security
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),

    // Jackal
    JACKAL_SEED: z.string().min(1, "JACKAL_SEED is required"),
    JACKAL_RPC_URL: z.string().url().default('https://rpc.jackalprotocol.com'),
    JACKAL_API_URL: z.string().url().default('https://api.jackalprotocol.com'),

    // Resource Monitor
    MAX_CONCURRENT_JOBS: z.coerce.number().default(4),
    CPU_THRESHOLD_HIGH: z.coerce.number().default(90),
    CPU_THRESHOLD_LOW: z.coerce.number().default(70),
    MEMORY_THRESHOLD_LOW: z.coerce.number().default(20),
    ADAPTIVE_CHECK_INTERVAL: z.coerce.number().default(60000),

    // Stripe
    STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
    STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required"),
    STRIPE_PRO_PRICE_ID: z.string().optional(),

    // Email
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().default('587').transform(Number),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().default('Nest <noreply@nest.app>'),

    // Frontend
    FRONTEND_URL: z.string().default('http://localhost:5173'),

    // Storage
    DOWNLOAD_GATEWAY_URL: z.string().url().default('https://gateway.lazybird.io'),

    // Monitoring
    SENTRY_DSN: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
    console.error('❌ Invalid environment variables:', JSON.stringify(_env.error.format(), null, 2));
    process.exit(1);
}

export const env = _env.data;

// Doppler confirmation log (only in production)
if (env.NODE_ENV === 'production') {
    console.log('✅ Production environment loaded successfully (managed by Doppler/Systemd)');
}
