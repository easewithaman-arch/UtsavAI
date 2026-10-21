/**
 * UtsavAI dev runner: starts the AI/API server and the Vite dev server together,
 * so the client's /api proxy has something to talk to. Zero dependencies.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const npx = isWindows ? 'npx.cmd' : 'npx';

const children = [];
let shuttingDown = false;

function run(label, command, args) {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWindows,
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`\n[utsavai] ${label} stopped (${reason}). Shutting down.`);
    shutdown();
  });
  child.on('error', (error) => {
    console.error(`\n[utsavai] Failed to start ${label}:`, error.message);
    shutdown();
  });
  children.push(child);
  return child;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(0), 200).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[utsavai] Starting API server on http://localhost:8787 ...');
run('api server', process.execPath, [path.join(ROOT, 'server', 'index.mjs')]);

console.log('[utsavai] Starting Vite dev server on http://localhost:5173 ...');
run('vite', npx, ['vite']);

console.log('[utsavai] Both servers starting. Open http://localhost:5173 in your browser.');
console.log('[utsavai] Set AI_API_KEY in .env for real AI mode; without it the app runs in demo mode.');
