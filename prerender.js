import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = 4173; // Default vite preview port

const ROUTES = [
    '/',
    '/docs',
    '/docs/architecture',
    '/docs/api',
    '/docs/frontend',
    '/docs/database',
    '/terms',
    '/privacy'
];

async function prerender() {
    console.log('📦 Starting Prerendering...');

    // 1. Start the file server
    console.log('Starting preview server...');
    const server = spawn('npm', ['run', 'preview'], {
        stdio: 'ignore', // Suppress output
        detached: true
    });

    // Give server time to start
    await new Promise(r => setTimeout(r, 4000));

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox']
        });

        const page = await browser.newPage();

        for (const route of ROUTES) {
            const url = `http://localhost:${PORT}${route}`;
            console.log(`📸 Prerendering: ${route}...`);

            // Use domcontentloaded (fastest) + explicit selector wait
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Ensure React has mounted by checking for the root div or a known element
            try {
                await page.waitForSelector('#root', { timeout: 10000 });
            } catch (e) {
                console.warn(`⚠️ Selector timeout for ${route}, proceeding anyway...`);
            }

            // Wait a bit extra for animations/react-helmet
            await new Promise(r => setTimeout(r, 3000));

            const content = await page.content();

            // Determine file path: / -> index.html, /docs -> docs/index.html
            const fileName = route === '/' ? 'index.html' : `${route.substring(1)}/index.html`;
            const filePath = path.join(DIST_DIR, fileName);

            // Ensure directory exists
            const dirPath = path.dirname(filePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            fs.writeFileSync(filePath, content);
            console.log(`✅ Saved: ${fileName}`);
        }

    } catch (err) {
        console.error('❌ Prerender Error:', err);
        process.exit(1);
    } finally {
        if (browser) await browser.close();

        // Kill the server
        try {
            process.kill(-server.pid);
        } catch (e) {
            server.kill();
        }
        console.log('✨ Prerendering Complete!');
        process.exit(0);
    }
}

prerender();
