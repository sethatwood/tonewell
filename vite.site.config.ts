// Builds the website's script into site/assets/js: the "Hear a taste" button,
// with the app's audio engine split into its own file and loaded on demand.
// The output is committed, so the server deploys site/ as plain files.

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  publicDir: false,
  base: '/assets/js/',
  build: {
    outDir: resolve(import.meta.dirname, 'site/assets/js'),
    emptyOutDir: true,
    target: 'safari16',
    modulePreload: false,
    // Keep the AudioWorklet module a separate file, never an inlined data: URL.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { site: resolve(import.meta.dirname, 'src/site/main.ts') },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
