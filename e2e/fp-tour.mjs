// A tour of first person for screenshots (not a test): the car along and across, seated, the bridge, the platform looking up.
import { withBrowser, ready, SHOTS } from './lib.mjs';
const OUT = process.env.OUT || SHOTS;
const nFrames = (page, n) => page.evaluate((n) => new Promise((done) => { const f = () => (--n <= 0 ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
await withBrowser(async ({ page, url }) => {
  await page.goto(`${url}#/station`);
  await page.waitForFunction(() => window.__station && window.__station.frames() > 20, { timeout: 120000 });
  const st = (f, a) => page.evaluate(f, a);
  const face = (yaw, pitch = 0) => st(([yaw, pitch]) => { const s = window.__station, l = s.firstPerson(); s.look(-(yaw - l.yaw) / 0.0024, -(pitch - l.pitch) / 0.0024); }, [yaw, pitch]);
  for (const [name, x, z] of [['tp-platform', 60, 7.5], ['tp-hall', 40, 16]]) {
    for (let i = 0; i < 4; i++) { await st(([x, z]) => { window.__station.setTime(20 + 40, { hold: true }); window.__station.teleport(x, z); }, [x, z]); await nFrames(page, 8); }
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  await page.keyboard.press('KeyC');
  const at = async (name, setup, yaw, pitch = 0, settle = 4) => {
    for (let i = 0; i < settle; i++) { await st(setup); await nFrames(page, 6); }
    await face(yaw, pitch); await nFrames(page, 3);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  const tunnel = () => { window.__station.setTime(20 + 18 + 8, { hold: true }); window.__station.board(0, 22, 0); };
  const bridge = () => { window.__station.setTime(20 + 18 + 28, { hold: true }); window.__station.board(0, 22, 0); };
  await at('fp-car-along', tunnel, Math.PI / 2);
  await at('fp-car-across', tunnel, Math.PI);
  await st(() => { window.__station.sit(); });
  await nFrames(page, 10);
  await face(Math.PI); await nFrames(page, 3);
  await page.screenshot({ path: `${OUT}/fp-car-seated.png` });
  await st(() => window.__station.stand());
  await at('fp-bridge-along', bridge, Math.PI / 2);
  await at('fp-bridge-window', bridge, Math.PI, 0.1);
  await at('fp-platform-up', () => { window.__station.setTime(20 + 40, { hold: true }); window.__station.teleport(60, 7.5); }, Math.PI, 0.9);
  await at('fp-hall', () => { window.__station.setTime(20 + 40, { hold: true }); window.__station.teleport(60, 12); }, -Math.PI / 2, 0.2);
});
