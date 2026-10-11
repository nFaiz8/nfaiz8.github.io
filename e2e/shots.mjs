// Quick look: screenshots at a few spots. Usage: node e2e/shots.mjs [renderer]
import { withBrowser, ready, sleep, SHOTS } from './lib.mjs';

const r = process.argv[2] || 'canvas';
await withBrowser(async ({ page, url, errors }) => {
  await page.goto(`${url}?r=${r}`);
  await ready(page);
  await sleep(1500);
  await page.screenshot({ path: `${SHOTS}/${r}-lobby.png` });
  const spots = await page.evaluate(() => {
    const { map } = window.__ascii;
    return map.rooms.filter((x) => x.plan).map((room) => ({ id: room.id, f: room.frames[0] }));
  });
  for (const id of ['red', 'teal', 'darkroom']) {
    const s = spots.find((x) => x.id === id) || spots[0];
    await page.evaluate((f) => window.__ascii.teleport(f.stand.x + 0.5, f.stand.y + 0.5), s.f);
    await sleep(2500);
    await page.screenshot({ path: `${SHOTS}/${r}-${s.id}.png` });
  }
  const fps = await page.evaluate(() => {
    const t = window.__ascii.stats.times.slice(-120);
    return { fps: Math.round(t.length / t.reduce((a, b) => a + b, 0)), worst: Math.round(Math.max(...t) * 1000) };
  });
  console.log('fps', fps, 'errors', errors);
});
