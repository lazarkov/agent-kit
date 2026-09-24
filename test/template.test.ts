import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readFrontmatterValue, rewriteFrontmatter } from '../src/frontmatter.js';
import { templatePath, toBlueprintId, toDisplayName } from '../src/paths.js';

const STARTER = readFileSync(templatePath('starter'), 'utf8');

describe('the vendored starter', () => {
  it('is findable from source and from dist alike', () => {
    expect(templatePath('starter').endsWith('/templates/starter.md')).toBe(true);
  });

  it('carries the five required frontmatter fields', () => {
    for (const key of ['id', 'version', 'name', 'description', 'category']) {
      expect(readFrontmatterValue(STARTER, key), key).not.toBeNull();
    }
  });

  it('has the sections a document needs to deploy at all', () => {
    // Validated against the live platform when it was written: with the id rewritten,
    // this exact text comes back 200 with a preview.
    for (const section of ['## Config', '## Onboarding', '## Environment', '## Runtime', '## Soul']) {
      expect(STARTER).toContain(section);
    }
  });

  it('ships the id the platform rejects, so an unedited copy cannot be deployed by accident', () => {
    // 'my-agent' is on the platform's placeholder list. init replaces it; anyone who
    // copies the file by hand gets told to name their agent.
    expect(readFrontmatterValue(STARTER, 'id')).toBe('my-agent');
  });
});

describe('rewriteFrontmatter', () => {
  it('replaces the scalars and leaves the body alone', () => {
    const out = rewriteFrontmatter(STARTER, { id: 'notes', name: 'Notes' });
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
