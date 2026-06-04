import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@lazybird-inc/nest-crypto': path.resolve(__dirname, './src/crypto-loader.ts'),
    },
  },
  plugins: [
    react(),
    wasm(),
    topLevelAwait()
  ],
})
