import express from 'express';
import { db } from '../db';
import { files, collabFolders, dropZones } from '../db/schema';
import { eq, and, isNull, or } from 'drizzle-orm';
import { env } from '../config/env';

const router = express.Router();

// Escape a value for safe interpolation into an HTML attribute / text context.
const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const generateOGHtml = (
    title: string,
    description: string,
    kind: 's' | 'dz' | 'collab',
    token: string,
    _isDead = false
) => {
    const redirectUrl = env.FRONTEND_URL || 'https://nest.lazybird.io';
    // Build the redirect target from the validated token ONLY. Never reflect raw
    // request input (req.originalUrl) into the page — that was a reflected-XSS sink
    // (the token flowed unescaped into both an attribute and an inline <script>).
    // encodeURIComponent guarantees a single, safe URL path segment.
    const targetUrl = `${redirectUrl}/${kind}/${encodeURIComponent(token)}`;

    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeTargetUrl = escapeHtml(targetUrl);

    // Redirect via meta-refresh (no inline JS) so the page works even under a strict
    // Content-Security-Policy that blocks inline scripts.
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="refresh" content="0; url=${safeTargetUrl}" />
    <title>${safeTitle}</title>
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:image" content="https://nest.lazybird.io/og-card.png" />
    <meta property="og:url" content="${safeTargetUrl}" />
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:title" content="${safeTitle}" />
    <meta property="twitter:description" content="${safeDescription}" />
    <meta property="twitter:image" content="https://nest.lazybird.io/og-card.png" />
</head>
<body>
    <p>Redirecting to Nest… If you are not redirected, <a href="${safeTargetUrl}">click here</a>.</p>
</body>
</html>`;
};

// 1. GET /s/:tokenOrSlug
router.get('/s/:tokenOrSlug', async (req, res) => {
    const { tokenOrSlug } = req.params;
    try {
        const [file] = await db.select().from(files)
            .where(
                and(
                    or(eq(files.share_token, tokenOrSlug), eq(files.share_custom_slug, tokenOrSlug)),
                    isNull(files.deleted_at)
                )
            )
            .limit(1);

        const isDead = !file || !file.share_token || 
            (file.share_expires_at && new Date(file.share_expires_at) < new Date()) ||
            (file.share_max_downloads && file.share_download_count >= file.share_max_downloads);

        if (isDead) {
            return res.status(410).send(generateOGHtml('Nest', 'This link is no longer available', 's', tokenOrSlug, true));
        }

        res.send(generateOGHtml('Nest', 'An encrypted file was shared with you via Nest', 's', tokenOrSlug));
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

// 2. GET /dz/:tokenOrSlug
router.get('/dz/:tokenOrSlug', async (req, res) => {
    const { tokenOrSlug } = req.params;
    try {
        const [dz] = await db.select().from(dropZones)
            .where(
                and(
                    or(eq(dropZones.token, tokenOrSlug), eq(dropZones.custom_slug, tokenOrSlug)),
                    isNull(dropZones.revoked_at)
                )
            )
            .limit(1);

        const isDead = !dz || (dz.expires_at && new Date(dz.expires_at) < new Date());

        if (isDead) {
            return res.status(410).send(generateOGHtml('Nest', 'This link is no longer available', 'dz', tokenOrSlug, true));
        }

        res.send(generateOGHtml('Nest', 'An encrypted file was shared with you via Nest', 'dz', tokenOrSlug));
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

// 3. GET /collab/:tokenOrSlug
router.get('/collab/:tokenOrSlug', async (req, res) => {
    const { tokenOrSlug } = req.params;
    try {
        const [collab] = await db.select().from(collabFolders)
            .where(
                and(
                    or(eq(collabFolders.token, tokenOrSlug), eq(collabFolders.custom_slug, tokenOrSlug)),
                    isNull(collabFolders.revoked_at)
                )
            )
            .limit(1);

        const isDead = !collab || (collab.expires_at && new Date(collab.expires_at) < new Date());

        if (isDead) {
            return res.status(410).send(generateOGHtml('Nest', 'This link is no longer available', 'collab', tokenOrSlug, true));
        }

        res.send(generateOGHtml('Nest', 'An encrypted file was shared with you via Nest', 'collab', tokenOrSlug));
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

export default router;
