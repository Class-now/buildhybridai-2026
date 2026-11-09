import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/. Override with VITE_BASE for other hosts.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/buildhybridai-2026/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
