import { defineConfig } from 'vite';

// GitHub Pages serves the site from /Play-Mesopotamia/; the dev server stays at the root.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'serve' && !isPreview ? '/' : '/Play-Mesopotamia/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
}));
