import type { IncomingMessage, Server } from 'node:http';

export const SECURITY_HEADERS: Readonly<Record<string, string>>;
export function loadEnvFile(file: string): void;
export function readBody(req: IncomingMessage, maxBytes?: number): Promise<unknown>;
export function safeFilePath(distDir: string, pathname: string): string | null;
export function createServer(options?: {
  distDir?: string;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
}): Server;
export function start(): Server;
