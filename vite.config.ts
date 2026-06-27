import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// Mirror of the host (Netlify) security headers in public/_headers, so the header-only
// policies — frame-ancestors and Content-Security-Policy-Report-Only — can be tested
// under `vite dev` / `vite preview` (which don't read _headers). Keep in sync with
// public/_headers. The Report-Only policy is the stricter trial (script-src without
// 'unsafe-inline'); violations log to the DevTools console but block nothing.
const REPORT_ONLY_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.lazybird.io wss://*.lazybird.io http://localhost:* ws://localhost:*; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self';"

const setSecurityHeaders = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
  res.setHeader('Content-Security-Policy-Report-Only', REPORT_ONLY_CSP)
}

const devSecurityHeaders = {
  name: 'dev-security-headers',
  configureServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      setSecurityHeaders(res)
      next()
    })
  },
  configurePreviewServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      setSecurityHeaders(res)
      next()
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  // The published @lazybird-inc/nest-crypto package is now bundled directly (vite-plugin-wasm
  // + top-level-await handle its libsodium/hash-wasm WASM). Previously this aliased to
  // src/crypto-loader.ts, which proxied the UMD global (window.NestCrypto) loaded via an
  // SRI-pinned <script> in index.html. That UMD path is kept in git history as a fallback.
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    devSecurityHeaders
  ],
})
