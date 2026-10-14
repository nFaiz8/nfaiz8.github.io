// Run the gallery and the multiplayer server together, for playing against yourself locally.
// Open the printed address in two windows (one private) to get two players. Ctrl+C stops both.
// Usage: npm run dev:live
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const procs = [
  ['server', path.join(root, 'server')],
  ['site', root],
].map(([name, cwd]) => {
  const p = spawn('npm', ['run', 'dev'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const tag = `[${name}] `;
  for (const stream of [p.stdout, p.stderr]) {
    stream.on('data', d => process.stdout.write(String(d).replace(/^(?=.)/gm, tag)));
  }
  p.on('exit', code => { console.log(`${tag}exited (${code})`); stop(); });
  return p;
});

console.log('\n  Play at http://localhost:5173/?live=ws://127.0.0.1:8787\n');

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  // Each npm runs in its own process group, so signal the group: killing npm alone leaves vite running.
  for (const p of procs) {
    try { process.kill(-p.pid, 'SIGTERM'); } catch {}
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
