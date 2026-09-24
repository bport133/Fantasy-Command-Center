import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  // Relative asset paths so the site works under https://<user>.github.io/<repo>/.
  base: './',
  envDir: '..',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)) },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  test: { root: '.', include: ['test/**/*.test.ts'] },
});
