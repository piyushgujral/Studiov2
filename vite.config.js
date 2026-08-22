import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this repository under /Studiov2/.
  base: process.env.NODE_ENV === 'production' ? '/Studiov2/' : '/',
  server: {
    port: 3000,
    host: true
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
});
