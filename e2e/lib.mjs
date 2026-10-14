// Shared e2e helpers: a Vite dev server and puppeteer's own Chrome for Testing (never the user's Chrome).
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SHOTS = path.join(root, 'e2e/shots');

// PUPPETEER_EXECUTABLE_PATH / E2E_ANGLE let this run on machines without Metal (e.g. Linux + SwiftShader).
export function launchBrowser() {
  const angle = process.env.E2E_ANGLE || 'metal';
  return puppeteer.launch({ headless: true, args: [`--use-angle=${angle}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])] });
}

export async function withBrowser(fn, { port = 5199 } = {}) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port, strictPort: true }, logLevel: 'error' });
  await server.listen();
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    return await fn({ page, browser, url: `http://localhost:${port}/`, errors });
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

export async function ready(page) {
  await page.waitForFunction(() => window.__ascii && window.__ascii.stats.frames > 5, { timeout: 15000 });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
