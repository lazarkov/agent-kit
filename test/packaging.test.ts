import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { packageRoot, templatePath } from '../src/paths.js';

interface Manifest {
  name: string;
  bin: Record<string, string>;
  files: string[];
  engines: { node: string };
  dependencies?: Record<string, string>;
  scripts: Record<string, string>;
}

const root = packageRoot();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;

/**
 * The promises a published tarball has to keep. Each of these is a bug that only
 * shows up after `npm publish`, when the fix is a new version number.
 */
describe('the package', () => {
  it('ships the templates directory, or init breaks for everyone who installs it', () => {
    expect(manifest.files).toContain('templates');
    expect(existsSync(templatePath('starter'))).toBe(true);
  });

  it('ships the build, and the bins point into it', () => {
    expect(manifest.files).toContain('dist');
    for (const target of Object.values(manifest.bin)) {
      expect(target).toBe('dist/cli.js');
    }
    expect(Object.keys(manifest.bin)).toEqual(['agent-kit', 'agent']);
  });

  it('has no runtime dependencies', () => {
    // Deliberate, and documented in CONTRIBUTING: this installs globally next to
    // other people's toolchains, so the arg parser and the colours are hand-rolled.
    expect(manifest.dependencies).toBeUndefined();
  });

  it('declares the Node version its own checks enforce', () => {
    // doctor fails a user below this line; engines is what npm warns about. If the two
    // disagree, one of them is lying.
    expect(manifest.engines.node).toBe('>=20.11');
    const doctor = readFileSync(join(root, 'src/commands/doctor.ts'), 'utf8');
    expect(doctor).toContain('const MINIMUM_NODE = [20, 11]');
  });

  it('cannot be published without building and passing', () => {
    expect(manifest.scripts.prepublishOnly).toContain('build');
    expect(manifest.scripts.prepublishOnly).toContain('test');
  });

  it('keeps the planning document out of the repository', () => {
    // SCOPE.md is internal. If it is ever tracked, this catches it in review.
    const ignored = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignored).toContain('SCOPE.md');
  });
});
