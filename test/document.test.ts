import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_DOCUMENT, loadDocument, MAX_SOURCE_BYTES } from '../src/document.js';
import { withTempDir } from './helpers.js';

const DOCUMENT = '---\nid: a\n---\n\n## Soul\n\nYou are careful.\n';

describe('loadDocument', () => {
  it('finds agent.md in the working directory', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, DEFAULT_DOCUMENT), DOCUMENT, 'utf8');
      expect(loadDocument(dir).source).toBe(DOCUMENT);
    });
  });

  it('takes a named file, whatever it is called', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'other.md'), DOCUMENT, 'utf8');
      const loaded = loadDocument(dir, 'other.md');
      expect(loaded.path).toBe(join(dir, 'other.md'));
    });
  });

  it('takes a directory and looks inside it for the conventional name', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, 'inbox-helper'));
      writeFileSync(join(dir, 'inbox-helper', DEFAULT_DOCUMENT), DOCUMENT, 'utf8');
      expect(loadDocument(dir, 'inbox-helper').path).toBe(
        join(dir, 'inbox-helper', DEFAULT_DOCUMENT),
      );
    });
  });

  it('never guesses between two documents', async () => {
    await withTempDir(async (dir) => {
      // Both are plausible, neither is agent.md, and picking one would be the kind of
      // help that eventually deploys the wrong agent.
      writeFileSync(join(dir, 'first.md'), DOCUMENT, 'utf8');
      writeFileSync(join(dir, 'second.md'), DOCUMENT, 'utf8');
      expect(() => loadDocument(dir)).toThrow(/No agent\.md in this directory/);
    });
  });

  it('says what to run when the directory is empty', async () => {
    await withTempDir(async (dir) => {
      try {
        loadDocument(dir);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toMatchObject({ exitCode: 2, hint: expect.stringContaining('agent init') });
      }
    });
  });

  it('reports an empty file as empty rather than sending nothing to the platform', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, DEFAULT_DOCUMENT), '   \n', 'utf8');
      expect(() => loadDocument(dir)).toThrow(/is empty/);
    });
  });

  it('measures the limit in bytes, not characters', async () => {
    await withTempDir(async (dir) => {
      // Just under in characters, well over in UTF-8: the platform counts bytes, so a
      // document of em dashes must be refused on the same terms it will be there.
      const source = '—'.repeat(MAX_SOURCE_BYTES / 2);
      writeFileSync(join(dir, DEFAULT_DOCUMENT), source, 'utf8');
      expect(source.length).toBeLessThan(MAX_SOURCE_BYTES);
      expect(() => loadDocument(dir)).toThrow(/the limit is 64 KB/);
    });
  });

  it('accepts a document right up against the limit', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, DEFAULT_DOCUMENT), 'x'.repeat(MAX_SOURCE_BYTES), 'utf8');
      expect(loadDocument(dir).source).toHaveLength(MAX_SOURCE_BYTES);
    });
  });
});
