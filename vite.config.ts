import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import process from 'node:process';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'safari16',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        visuals: resolve(import.meta.dirname, 'visuals.html'),
        learn: resolve(import.meta.dirname, 'learn.html'),
        settings: resolve(import.meta.dirname, 'settings.html'),
      },
    },
  },
}));
