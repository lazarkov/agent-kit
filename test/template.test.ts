import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readFrontmatterValue,
  readScalar,
  rewriteFrontmatter,
  rewriteScalars,
} from '../src/frontmatter.js';
import { projectTemplateDir, toBlueprintId, toDisplayName } from '../src/paths.js';
import { MANIFEST, PROJECT_FILES } from '../src/project.js';

const root = projectTemplateDir();
const manifest = readFileSync(join(root, MANIFEST), 'utf8');

/** Every file under a directory, relative and with forward slashes. */
function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const next = prefix === '' ? entry.name : `${prefix}${sep}${entry.name}`;
    return entry.isDirectory() ? listFiles(dir, next) : [next.split(sep).join(posix.sep)];
  });
}

describe('the vendored scaffold', () => {
  it('is findable from source and from dist alike', () => {
    // `templates/` sits beside `src/` and `dist/`, so this has to resolve either way.
    expect(existsSync(join(root, MANIFEST))).toBe(true);
  });

  it('carries the five required manifest fields', () => {
    for (const key of ['id', 'version', 'name', 'description', 'category']) {
      expect(readScalar(manifest, key), key).not.toBeNull();
    }
  });

  it('ships the environment file under a name npm will not drop', () => {
    // This package gitignores `.env`, and npm falls back to .gitignore when packing, so
    // a template literally called `.env` is missing from every install. init renames it.
    expect(existsSync(join(root, 'env'))).toBe(true);
    expect(existsSync(join(root, '.env'))).toBe(false);
  });

  it('holds one file per section and nothing that maps to no section', () => {
    // A file here that the compiler does not know about would be invisible: it would
    // sit in every scaffolded project looking meaningful and reach no agent.
    const known = [...PROJECT_FILES, 'env', 'files/home/notes/README.md'];
    for (const file of listFiles(root)) {
      expect(known, file).toContain(file);
    }
  });

  it('ships the id the platform rejects, so an unedited copy cannot deploy by accident', () => {
    // 'my-agent' is on the platform's placeholder list. init replaces it; anyone who
    // copies the directory by hand gets told to name their agent.
    expect(readScalar(manifest, 'id')).toBe('my-agent');
  });

  it('keeps real credentials out of the file that gets committed', () => {
    // Every value in the scaffold's environment is a placeholder resolved at deploy
    // time. A literal key here would be published by the first `git push`.
    const env = readFileSync(join(root, 'env'), 'utf8');
    const values = env
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => line.slice(line.indexOf('=') + 1).trim());
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toContain('{{');
  });
});

describe('rewriteFrontmatter', () => {
  const DOCUMENT = '---\nid: my-agent\nname: My Agent\n---\n\n## Soul\n\nYou are a notebook.\n';

  it('replaces the scalars and leaves the body alone', () => {
    const out = rewriteFrontmatter(DOCUMENT, { id: 'notes', name: 'Notes' });
    expect(readFrontmatterValue(out, 'id')).toBe('notes');
    expect(readFrontmatterValue(out, 'name')).toBe('Notes');
    expect(out).toContain('## Soul');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('does not touch a soul line that merely looks like frontmatter', () => {
    const source = '---\nid: a\n---\n\n## Soul\n\nname: not frontmatter\n';
    const out = rewriteFrontmatter(source, { id: 'b' });
    expect(out).toContain('name: not frontmatter');
    expect(readFrontmatterValue(out, 'name')).toBeNull();
  });

  it('adds a key the document did not have', () => {
    const out = rewriteFrontmatter('---\nid: a\n---\n\nbody\n', { name: 'A' });
    expect(readFrontmatterValue(out, 'name')).toBe('A');
  });

  it('leaves a document with no frontmatter exactly as it was', () => {
    const source = '# just markdown\n';
    expect(rewriteFrontmatter(source, { id: 'x' })).toBe(source);
  });

  it('rewrites a bare manifest, which has no --- to find', () => {
    // What init does to agent.yaml: the same two scalars, without the fences.
    const out = rewriteScalars(manifest, { id: 'notes', name: 'Notes' });
    expect(readScalar(out, 'id')).toBe('notes');
    expect(readScalar(out, 'name')).toBe('Notes');
    expect(out).toContain('category:');
  });
});

describe('naming', () => {
  it('slugs a directory name into a blueprint id', () => {
    expect(toBlueprintId('Inbox Helper')).toBe('inbox-helper');
    expect(toBlueprintId('my_agent.v2')).toBe('my-agent-v2');
    expect(toBlueprintId('  ')).toBe('my-agent');
  });

  it('turns an id back into a title', () => {
    expect(toDisplayName('inbox-helper')).toBe('Inbox Helper');
  });
});
