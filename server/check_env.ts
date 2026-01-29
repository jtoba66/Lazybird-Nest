
import { env } from './src/config/env';
import { PRICING } from './src/config/pricing';

console.log('--- ENV CHECK ---');
console.log('STRIPE_PRO_PRICE_ID from env:', env.STRIPE_PRO_PRICE_ID);
console.log('PRICING.pro.monthly.priceId:', PRICING.pro.monthly.priceId);
console.log('--- END CHECK ---');
