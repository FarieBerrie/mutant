import { defineConfig } from 'vite';

// Relative asset paths so the built game works from any folder (GitHub Pages, itch.io, a USB stick…).
export default defineConfig({
  base: './',
  server: { port: 5190 },
});
