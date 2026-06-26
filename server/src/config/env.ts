import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file for local development
const envFile = process.env.NODE_ENV === 'test' ? '../../.env.test' : '../../.env';
const envPath = path.resolve(__dirname, envFile);
dotenv.config({ path: envPath, override: true });

// Fallback: Try loading from current working directory if above failed
if (!process.env.JACKAL_SEED) {
    dotenv.config({ override: true });
}

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
    STRIPE_PRO_YEARLY_PRICE_ID: z.string().optional(),
    STRIPE_MAX_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_MAX_YEARLY_PRICE_ID: z.string().optional(),

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
    STORAGE_PROVIDER: z.enum(['jackal', 'obsideo', 'local']).default('jackal'),

    // Obsideo credentials (optional — only required when STORAGE_PROVIDER=obsideo)
    OBSIDEO_API_KEY: z.string().optional(),
    OBSIDEO_ACCOUNT_ID: z.string().optional(),
    OBSIDEO_CUSTOMER_PUBLIC_KEY: z.string().optional(),
    OBSIDEO_CUSTOMER_PRIVATE_KEY: z.string().optional(),
    OBSIDEO_COORDINATOR_URL: z.string().url().default('https://coordinator.obsideo.io'),
    OBSIDEO_COORDINATOR_PUBLIC_KEY: z.string().optional(),
    OBSIDEO_BUNDLE_STORE_PATH: z.string().default('/var/nest/obsideo-bundle').transform(v => {
        if (process.env.NODE_ENV !== 'production' && v.startsWith('/app/')) {
            return path.join(process.cwd(), 'uploads', 'obsideo-bundle');
        }
        return v;
    }),

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
