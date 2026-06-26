import postgres from 'postgres';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function globalSetup() {
    console.log('--- Playwright Global Setup ---');
    console.log('Creating ephemeral test database: nest_test');

    const adminDbUrl = 'postgresql://localhost:5432/postgres';
    const testDbName = 'nest_test';
    
    const sql = postgres(adminDbUrl);
    
    try {
        await sql.unsafe(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE);`);
        await sql.unsafe(`CREATE DATABASE ${testDbName};`);
        console.log(`✅ Database ${testDbName} recreated.`);
    } catch (e) {
        console.error('Failed to recreate test database', e);
        throw e;
    } finally {
        await sql.end();
    }

    console.log('Running Drizzle migrations on nest_test...');
    
    const serverDir = path.resolve(__dirname, '../../server');
    try {
        execSync('npx drizzle-kit push', {
            cwd: serverDir,
            env: {
                ...process.env,
                DATABASE_URL: `postgresql://localhost:5432/${testDbName}`
            },
            stdio: 'inherit'
        });
        console.log('✅ Migrations pushed successfully.');
    } catch (e) {
        console.error('Failed to push migrations', e);
        throw e;
    }

    // --- Create shared test user and save storageState ---
    // We launch a real browser, sign up once, and save the localStorage auth
    // tokens. Every test then reuses this storageState — no repeated logins.
    console.log('Creating shared test user...');
    
    const authDir = path.resolve(__dirname, '../.auth');
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    const storageFile = path.join(authDir, 'user.json');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('http://localhost:5173/signup');

    // Switch to register if needed
    const registerTab = page.locator('button:has-text("Register")');
    if (await registerTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await registerTab.click();
    }

    const email = `e2e_user_${Date.now()}@test.local`;
    await page.fill('input[type="email"]', email);
    await page.locator('input[type="password"]').nth(0).fill('Password123!');
    await page.locator('input[type="password"]').nth(1).fill('Password123!');
    await page.locator('input[type="checkbox"]').click();
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Wait until we're on the dashboard
    await page.waitForURL('**/dashboard', { timeout: 20000 });
    console.log(`✅ Test user created: ${email}`);

    // Save full browser storage state (includes cookies + localStorage)
    await context.storageState({ path: storageFile });
    console.log(`✅ Auth state saved to ${storageFile}`);

    await browser.close();
}

export default globalSetup;
