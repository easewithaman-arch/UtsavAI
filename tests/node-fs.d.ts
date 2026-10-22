// Minimal ambient types for the Node API used by the test suite, so the
// project does not need to pull in the full @types/node package.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
