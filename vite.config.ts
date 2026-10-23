import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// GitHub Pages serves the site from /<repo>/, so the build uses a relative base.
export default defineConfig({
  base: './',
  plugins: [preact()],
  test: {
    environment: 'node',
  },
});
