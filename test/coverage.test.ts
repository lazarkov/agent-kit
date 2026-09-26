import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { printHelp } from '../src/help.js';
import { Style } from '../src/output.js';
import { packageRoot } from '../src/paths.js';
import { COMMANDS } from '../src/run.js';
import { recordingIo } from './helpers.js';

const root = packageRoot();
const testDir = join(root, 'test');
const suites = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => readFileSync(join(testDir, name), 'utf8'))
  .join('\n');

const names = Object.keys(COMMANDS);

/**
 * The guard against a command shipping quietly.
 *
 * Adding one to the table in `run.ts` is one line, and the two things easiest to
 * forget afterwards are a test and a line of help, which together are the whole
 * difference between a feature and a surprise. Both are asserted here for every
 * command, so a new one fails the suite until it has both.
 */
describe('every command', () => {
  it('has at least one test of its own', () => {
    const missing = names.filter(
      (name) => !new RegExp(`describe\\(\\s*['\`]${name}\\b`).test(suites),
    );
    expect(missing, `no describe('${missing.join("'), describe('")}') in test/`).toEqual([]);
  });

  it('appears on the help screen', () => {
    const io = recordingIo();
    printHelp(io, new Style(false), '0.0.0');
    const help = io.text();
    expect(names.filter((name) => !help.includes(name))).toEqual([]);
  });

  it('appears in the README’s table', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(names.filter((name) => !readme.includes(`agent ${name}`))).toEqual([]);
  });

  it('appears in the skill, which is read instead of the README', () => {
    // Someone using the skill never sees the README, so a command missing from it is a
    // command that does not exist as far as they are concerned.
    const skill = readFileSync(join(root, 'skills/agent-kit/SKILL.md'), 'utf8');
    expect(names.filter((name) => !skill.includes(`agent ${name}`))).toEqual([]);
  });
});
