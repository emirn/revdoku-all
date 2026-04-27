import { defineConfig } from 'vite'
import RubyPlugin from 'vite-plugin-ruby'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// `@ee` resolves to the frontend overlay directory when present, or to the
// core-specific frontend directory otherwise. Shared code imports from
// `@ee/...` unconditionally; the filesystem is the switch. Trees without
// the overlay fall back to the core folder (whose modules typically return
// null). No edition flags, no @ifdef markers, no runtime branching.
const overlayDir = path.resolve(__dirname, './ee/app/frontend/src')
const coreDir    = path.resolve(__dirname, './app/frontend/src/core')
const eeAlias    = fs.existsSync(overlayDir) ? overlayDir : coreDir

export default defineConfig({
  plugins: [
    RubyPlugin(),
    react(),
  ],
  resolve: {
    alias: {
      '@':           path.resolve(__dirname, './app/frontend/src'),
      '@ee':         eeAlias,
      '@revdoku/lib': path.resolve(__dirname, '../shared/js-packages/revdoku-lib'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
  esbuild: {
    pure: ['console.log', 'console.debug'],
  },
  server: {
    hmr: {
      overlay: true,
    },
    proxy: {
      '/api': {
        target: 'https://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/envelopes/manifest': {
        target: 'https://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/cable': {
        target: 'https://localhost:3000',
        ws: true,
        secure: false,
      },
    },
  },
})
