/**
 * UtsavAI server: keeps AI credentials server-side, validates every request
 * and every model response, and serves the built client in production.
 * Zero runtime dependencies - plain Node http.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handlePlan, handleCopilot, getStatus } from './ai.mjs';

const pipe = promisify(pipeline);
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.map']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MAX_BODY = 512 * 1024;

/**
 * Applied to every response. The client is a static SPA that only talks to its
 * own /api routes, so it needs no third-party origins, frames or plugins.
 */
export const SECURITY_HEADERS = Object.freeze({
  'content-security-policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-permitted-cross-domain-policies': 'none',
  'x-dns-prefetch-control': 'off',
});

export function loadEnvFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* no .env file - demo mode still works */
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, code, message, extraHeaders = {}) {
  sendJson(res, status, { ok: false, error: { code, message } }, extraHeaders);
}

export function readBody(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(Object.assign(new Error('Request too large.'), { code: 'PAYLOAD_TOO_LARGE' }));
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Request too large.'), { code: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('Body must be valid JSON.'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function isJsonRequest(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

/** Rejects cross-site form/fetch posts while still allowing same-origin and non-browser clients. */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin) {
    try {
      if (!host || new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      if (hits.size > 5000) hits.clear();
      hits.set(key, { start: now, count: 1 });
      return { allowed: true, retryAfter: 0 };
    }
    entry.count += 1;
    if (entry.count > max) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000)) };
    }
    return { allowed: true, retryAfter: 0 };
  };
}

function clientKey(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function containsTraversalSegment(pathname) {
  const normalized = pathname.replace(/\\/g, '/');
  return /(^|\/)\.\.(\/|$)/.test(normalized);
}

export function safeFilePath(distDir, pathname) {
  if (!pathname || pathname.includes('\0')) return null;
  if (containsTraversalSegment(pathname)) return null;
  let decoded = pathname;
  try {
    for (let i = 0; i < 3; i += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (decoded.includes('\0')) return null;
      if (containsTraversalSegment(decoded)) return null;
    }
  } catch {
    return null;
  }
  const relativePath = decoded.replace(/^[/\\]+/, '');
  const resolved = path.resolve(distDir, relativePath || 'index.html');
  const relative = path.relative(distDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function serveStatic(req, res, pathname, distDir) {
  return serveStaticAsync(req, res, pathname, distDir).catch(() => {
    if (!res.headersSent) sendError(res, 500, 'SERVER_ERROR', 'Could not read that file.');
    else res.destroy();
  });
}

function etagFor(stat) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

function acceptsGzip(req) {
  const header = String(req.headers['accept-encoding'] || '');
  return /\bgzip\b/i.test(header) && !/\bgzip\s*;\s*q\s*=\s*0(?:\.0+)?\b/i.test(header);
}

function cacheControlFor(pathname, ext) {
  if (ext === '.html') return 'no-cache';
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

async function serveStaticAsync(req, res, pathname, distDir) {
  let dirStat;
  try {
    dirStat = await fsp.stat(distDir);
  } catch {
    res.writeHead(503, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Client build not found. Run "npm run build" first.');
    return;
  }
  if (!dirStat.isDirectory()) {
    sendError(res, 503, 'NO_BUILD', 'Client build not found.');
    return;
  }

  if (containsTraversalSegment(pathname)) {
    sendError(res, 403, 'FORBIDDEN', 'Forbidden.');
    return;
  }

  const requested = safeFilePath(distDir, pathname);
  if (!requested) {
    sendError(res, 403, 'FORBIDDEN', 'Forbidden.');
    return;
  }

  let filePath = requested;
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (stat.isDirectory()) throw new Error('Directory.');
  } catch {
    if (path.extname(pathname) || pathname.startsWith('/assets/')) {
      sendError(res, 404, 'NOT_FOUND', 'Not found.');
      return;
    }
    filePath = path.join(distDir, 'index.html');
    try {
      stat = await fsp.stat(filePath);
    } catch {
      sendError(res, 404, 'NOT_FOUND', 'Not found.');
      return;
    }
  }
  if (!stat.isFile()) {
    sendError(res, 404, 'NOT_FOUND', 'Not found.');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const etag = etagFor(stat);
  const compressible = COMPRESSIBLE.has(ext);
  const gzip = compressible && stat.size >= 512 && acceptsGzip(req);
  const headers = {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': cacheControlFor(pathname, ext),
    etag,
    'last-modified': stat.mtime.toUTCString(),
  };
  if (compressible) headers.vary = 'Accept-Encoding';
  if (gzip) headers['content-encoding'] = 'gzip';
  else headers['content-length'] = String(stat.size);

  const ifNoneMatch = String(req.headers['if-none-match'] || '');
  if (
    ifNoneMatch &&
    (ifNoneMatch.trim() === '*' ||
      ifNoneMatch
        .split(',')
        .map((tag) => tag.trim())
        .some((tag) => tag === etag || tag === etag.replace(/^W\//, '')))
  ) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  if (gzip) await pipe(stream, zlib.createGzip({ level: 6 }), res);
  else await pipe(stream, res);
}

export function createServer({
  distDir = DIST,
  rateLimitWindowMs = 60_000,
  rateLimitMax = 30,
} = {}) {
  const checkRate = createRateLimiter({ max: rateLimitMax, windowMs: rateLimitWindowMs });

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
    let pathname;
    const rawUrl = req.url || '/';
    if (rawUrl.length > 2048) {
      sendError(res, 414, 'URI_TOO_LONG', 'That address is too long.');
      return;
    }
    if (/%2e/i.test(rawUrl) || /%252e/i.test(rawUrl) || containsTraversalSegment(rawUrl)) {
      sendError(res, 403, 'FORBIDDEN', 'Forbidden.');
      return;
    }
    try {
      const url = new URL(rawUrl, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendError(res, 400, 'BAD_URL', 'That address could not be read.');
      return;
    }

    try {
      if (pathname === '/api/status' && req.method === 'GET') {
        sendJson(res, 200, getStatus());
        return;
      }

      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if ((pathname === '/api/plan' || pathname === '/api/copilot') && req.method === 'POST') {
        const limit = checkRate(clientKey(req));
        if (!limit.allowed) {
          sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', {
            'retry-after': String(limit.retryAfter),
          });
          return;
        }
        if (!isSameOrigin(req)) {
          sendError(res, 403, 'FORBIDDEN', 'Cross-site requests are not accepted.');
          return;
        }
        if (!isJsonRequest(req)) {
          sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with content-type application/json.');
          return;
        }
        const body = await readBody(req);
        const result = pathname === '/api/plan' ? await handlePlan(body) : await handleCopilot(body);
        sendJson(res, result.ok ? 200 : result.status || 400, result);
        return;
      }

      if (pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(
            res,
            405,
            { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } },
            { allow: 'GET, HEAD, POST' },
          );
          return;
        }
        sendError(res, 404, 'NOT_FOUND', 'Unknown API route.');
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, pathname, distDir);
        return;
      }

      sendJson(
        res,
        405,
        { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } },
        { allow: 'GET, HEAD' },
      );
    } catch (err) {
      const status = err && err.code === 'PAYLOAD_TOO_LARGE' ? 413 : err && err.code === 'BAD_JSON' ? 400 : 500;
      sendJson(res, status, {
        ok: false,
        error: {
          code: err && err.code ? err.code : 'SERVER_ERROR',
          message: status === 500 ? 'Something went wrong on our side.' : err.message,
        },
      });
    }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export function start() {
  loadEnvFile(path.join(ROOT, '.env'));
  const port = Number(process.env.PORT || 8787);
  const server = createServer();
  server.listen(port, () => {
    const status = getStatus();
    console.log(
      `UtsavAI server on http://localhost:${port} (${status.mode === 'ai' ? `real AI via ${status.model}` : 'demo mode - no AI key configured'})`,
    );
  });
  return server;
}

const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntryPoint) start();
