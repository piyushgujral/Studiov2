import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this repository under /Studiov2/.
  base: process.env.NODE_ENV === 'production' ? '/Studiov2/' : '/',
  server: {
    port: 3000,
    host: true
  },
  build: {
    // ES2020 keeps the generated bundle compatible with modern Safari/iOS,
    // Chrome/Android and Edge/Windows without forcing legacy polyfills.
    target: 'es2020',
    outDir: 'dist'
  }
});
