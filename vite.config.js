import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (p) => fileURLToPath(new URL(p, import.meta.url));

// The editor holds a GitHub token, so its built page may only talk to this site and GitHub.
// Build only: Vite's dev server needs inline styles and a websocket.
const CSP = "default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' blob: data:; style-src 'self'; script-src 'self'";
const editorCsp = {
  name: 'editor-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html, ctx) => (ctx.path.endsWith('edit/index.html')
      ? html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
      : html),
  },
};

// Photos are prepared into public/photos by scripts/prepare-photos.mjs; Vite serves and copies them.
export default defineConfig({
  base: './',
  plugins: [editorCsp],
  build: { target: 'es2022', rollupOptions: { input: { main: page('./index.html'), edit: page('./edit/index.html') } } },
});
