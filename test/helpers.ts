import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApiClient } from '../src/api.js';
import type { Io } from '../src/output.js';

/** Collects what a command printed, so a test can assert on the words a user sees. */
export function recordingIo(): Io & { lines: string[]; errors: string[]; text: () => string } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    out: (text) => void lines.push(text),
    err: (text) => void errors.push(text),
    text: () => lines.join('\n'),
  };
}

export interface FakeCall {
  method: string;
  url: string;
  body: unknown;
}

/**
 * An ApiClient with a scripted fetch. No test in this suite touches the network:
 * the platform's responses are transcribed from live ones, and a suite that needed
 * the internet would fail on a train rather than when something is broken.
 */
export function fakeApi(
  routes: Record<string, { status?: number; body: unknown }>,
): { client: ApiClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client = new ApiClient('https://api.test/api', async (url, init) => {
    const path = url.replace('https://api.test/api', '');
    calls.push({
      method: init?.method ?? 'GET',
      url: path,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const route = routes[path];
    if (!route) throw new Error(`No fake route for ${path}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { client, calls };
}

/** Always awaited, so the directory outlives an async command rather than the call. */
export async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-kit-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
