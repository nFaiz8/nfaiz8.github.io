import { defineConfig } from 'vite';

// Photos are prepared into public/photos by scripts/prepare-photos.mjs; Vite serves and copies them.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
