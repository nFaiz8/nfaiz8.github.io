// faiz.pics multiplayer: routes /room/<version>/<n> to one Gallery Durable Object per instance.
import { allowedOrigin, validVersion, LIMITS } from './rules.js';
export { Gallery } from './gallery.js';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([^/]+)\/(\d{1,2})$/);
    if (!allowedOrigin(req.headers.get('Origin'))) return new Response('forbidden', { status: 403 });
    if (!m) return new Response('not found', { status: 404 });
    let version;
    try { version = decodeURIComponent(m[1]); } catch { return new Response('bad version', { status: 400 }); }
    const n = Number(m[2]);
    if (!validVersion(version) || n < 1 || n > LIMITS.instances) return new Response('bad room', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const stub = env.GALLERY.get(env.GALLERY.idFromName(`${version}#${n}`));
    return stub.fetch(req);
  },
};
