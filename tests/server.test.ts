import { afterEach, describe, expect, it } from 'vitest';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, safeFilePath, SECURITY_HEADERS } from '../server/index.mjs';

interface TestResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function listen(options: Parameters<typeof createServer>[0] = {}): Promise<number> {
  const server = createServer(options);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

function request(
  port: number,
  requestPath: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function makeDist(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'utsavai-dist-'));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>UtsavAI test</title>');
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("test");');
  return dir;
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return Array.isArray(value) ? value.join(', ') : value ?? '';
}

describe('safeFilePath', () => {
  const root = path.resolve('dist');

  it('resolves normal files inside the build directory', () => {
    expect(safeFilePath(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(safeFilePath(root, '/')).toBe(path.join(root, 'index.html'));
  });

  it('rejects traversal and null bytes', () => {
    expect(safeFilePath(root, '/../secret.txt')).toBeNull();
    expect(safeFilePath(root, '../secret.txt')).toBeNull();
    expect(safeFilePath(root, '/assets/app\0.js')).toBeNull();
  });
});

describe('HTTP server', () => {
  it('adds security headers and never caches API responses', async () => {
    const port = await listen();
    const res = await request(port, '/api/health');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(header(res.headers, 'content-security-policy')).toContain("default-src 'self'");
    expect(header(res.headers, 'x-content-type-options')).toBe('nosniff');
    expect(header(res.headers, 'x-frame-options')).toBe('DENY');
    expect(header(res.headers, 'cache-control')).toBe('no-store');
    expect(SECURITY_HEADERS['referrer-policy']).toBe('no-referrer');
  });

  it('serves the SPA, static assets and SPA fallbacks with correct caching', async () => {
    const distDir = makeDist();
    const port = await listen({ distDir });

    const index = await request(port, '/');
    expect(index.status).toBe(200);
    expect(index.body).toContain('UtsavAI test');
    expect(header(index.headers, 'content-type')).toContain('text/html');
    expect(header(index.headers, 'cache-control')).toBe('no-cache');

    const asset = await request(port, '/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.body).toContain('console.log');
    expect(header(asset.headers, 'content-type')).toContain('text/javascript');
    expect(header(asset.headers, 'cache-control')).toContain('immutable');

    const fallback = await request(port, '/plans/123');
    expect(fallback.status).toBe(200);
    expect(fallback.body).toContain('UtsavAI test');
  });

  it('blocks encoded traversal attempts', async () => {
    const distDir = makeDist();
    const port = await listen({ distDir });
    const res = await request(port, '/%2e%2e/secret.txt');

    expect(res.status).toBe(403);
    expect(res.body).toContain('FORBIDDEN');
  });

  it('supports HEAD without sending a body', async () => {
    const distDir = makeDist();
    const port = await listen({ distDir });
    const res = await request(port, '/assets/app.js', { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(res.body).toBe('');
    expect(header(res.headers, 'content-length')).toBe(String(Buffer.byteLength('console.log("test");')));
  });

  it('requires JSON and same-origin requests for AI routes', async () => {
    const port = await listen();
    const plain = await request(port, '/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(plain.status).toBe(415);

    const crossSite = await request(port, '/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });
    expect(crossSite.status).toBe(403);

    const badFetchSite = await request(port, '/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: '{}',
    });
    expect(badFetchSite.status).toBe(403);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const port = await listen();
    const malformed = await request(port, '/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformed.body).error.code).toBe('BAD_JSON');

    const oversized = await request(port, '/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'x'.repeat(600 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    expect(JSON.parse(oversized.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rate limits AI routes and advertises when to retry', async () => {
    const port = await listen({ rateLimitMax: 2, rateLimitWindowMs: 60_000 });
    const options = { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' };

    expect((await request(port, '/api/plan', options)).status).toBe(415);
    expect((await request(port, '/api/copilot', options)).status).toBe(415);
    const limited = await request(port, '/api/plan', options);

    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body).error.code).toBe('RATE_LIMITED');
    expect(Number(header(limited.headers, 'retry-after'))).toBeGreaterThan(0);
  });

  it('returns 404 for unknown API routes and 405 for unsupported methods', async () => {
    const port = await listen();

    expect((await request(port, '/api/unknown')).status).toBe(404);
    expect((await request(port, '/api/unknown', { method: 'POST' })).status).toBe(405);

    const put = await request(port, '/', { method: 'PUT' });
    expect(put.status).toBe(405);
    expect(header(put.headers, 'allow')).toBe('GET, HEAD');
  });
});
