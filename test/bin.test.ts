import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { endQuietlyOnClosedPipe, main } from '../src/run.js';

/**
 * The bin's own behaviour: what reaches a terminal, and what exit code a script sees.
 * `run()` returns a number and throws; `main()` is the part that turns that into
 * stderr and `process.exitCode`, and it is the only part a user actually meets.
 */
function capture(argv: string[]): Promise<{ out: string; err: string; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  const argvBefore = process.argv;
  process.argv = ['node', '/somewhere/dist/cli.js', ...argv];

  return main()
    .then(() => ({
      out: out.join(''),
      err: err.join(''),
      code: process.exitCode === undefined ? 0 : Number(process.exitCode),
    }))
    .finally(() => {
      process.argv = argvBefore;
      stdout.mockRestore();
      stderr.mockRestore();
    });
}

afterEach(() => {
  // Left set, a failing command under test would become vitest's own exit code.
  process.exitCode = 0;
});

describe('main', () => {
  it('prints the version to stdout and exits zero', async () => {
    const { out, code } = await capture(['--version']);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(code).toBe(0);
  });

  it('puts a usage failure on stderr, with the hint and how to get help', async () => {
    const { out, err, code } = await capture(['nonsense']);

    expect(code).toBe(2);
    expect(err).toContain("Unknown command 'nonsense'");
    expect(err).toContain('validate');
    expect(err).toContain("Run 'agent --help' for usage.");
    // stdout stays clean, so `agent nonsense | something` pipes nothing.
    expect(out).toBe('');
  });

  it('does not tell a user with no document that they found a bug', async () => {
    const { err, code } = await capture(['validate', 'no/such/file.md']);

    expect(code).toBe(2);
    expect(err).toContain('No such file');
    expect(err).not.toContain('bug in the CLI');
  });

  it('prints help to stdout, not stderr, since asking for it is not an error', async () => {
    const { out, err, code } = await capture(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('Usage');
    expect(err).toBe('');
  });
});

/**
 * Found by piping the installed package into `head`: every list command printed a
 * stack trace over its own output and exited 1. Reading the first few lines of a list
 * is the most ordinary thing anyone does with one.
 */
describe('a reader that stops reading', () => {
  it('ends the program quietly and successfully', () => {
    const stream = new PassThrough();
    let exits = 0;
    endQuietlyOnClosedPipe(stream, () => {
      exits += 1;
    });

    stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    expect(exits).toBe(1);
  });

  it('still lets a real write failure be a failure', () => {
    const stream = new PassThrough();
    let exits = 0;
    endQuietlyOnClosedPipe(stream, () => {
      exits += 1;
    });

    // A full disk is not a reader walking away, and swallowing it would lose output
    // silently, which is the failure this is meant to be the opposite of.
    expect(() => stream.emit('error', Object.assign(new Error('no space'), { code: 'ENOSPC' }))).toThrow(
      /no space/,
    );
    expect(exits).toBe(0);
  });
});
