import { describe, expect, it } from 'vitest';

import { boolFlag, parseArgs, stringFlag } from '../src/args.js';
import { UsageError } from '../src/errors.js';

describe('parseArgs', () => {
  it('reads a command and its positionals', () => {
    const args = parseArgs(['init', 'my-project']);
    expect(args.command).toBe('init');
    expect(args.positionals).toEqual(['my-project']);
  });

  it('takes a value flag in both spellings', () => {
    expect(stringFlag(parseArgs(['validate', '--api', 'http://localhost:3001/api']), 'api')).toBe(
      'http://localhost:3001/api',
    );
    expect(stringFlag(parseArgs(['validate', '--api=http://localhost:3001/api']), 'api')).toBe(
      'http://localhost:3001/api',
    );
  });

  it('treats an unknown flag as a boolean rather than swallowing the next word', () => {
    // `agent search --verified billing` must search for billing, not for nothing.
    const args = parseArgs(['search', '--verified', 'billing']);
    expect(boolFlag(args, 'verified')).toBe(true);
    expect(args.positionals).toEqual(['billing']);
  });

  it('turns a flag off with --no-', () => {
    expect(parseArgs(['search', '--no-color']).flags.get('color')).toBe(false);
    expect(boolFlag(parseArgs(['search', '--no-color']), 'color', true)).toBe(false);
  });

  it('refuses a value flag with nothing after it', () => {
    expect(() => parseArgs(['models', '--provider'])).toThrow(UsageError);
    expect(() => parseArgs(['models', '--provider', '--json'])).toThrow(UsageError);
  });

  it('expands single-dash aliases and refuses the ones it does not know', () => {
    expect(boolFlag(parseArgs(['-j', 'runtimes']), 'json')).toBe(true);
    // Bundling is not supported on purpose: -hv is a typo more often than two flags.
    expect(() => parseArgs(['-hv'])).toThrow(UsageError);
  });

  it('stops reading flags after a bare --', () => {
    const args = parseArgs(['validate', '--', '--weird-name.md']);
    expect(args.positionals).toEqual(['--weird-name.md']);
    expect(args.flags.size).toBe(0);
  });
});
