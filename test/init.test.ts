import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { fakeApi, recordingIo, withTempDir } from './helpers.js';

const EXAMPLES = {
  data: [
    {
      slug: '01-minimal',
      name: 'PocketNotebook',
      description: 'Keeps durable notes in its own container.',
      kind: 'shared',
      sections: ['Config', 'Onboarding', 'Environment', 'Runtime', 'Soul'],
      source: '---\nid: pocket-notebook\nversion: 1.0.0\nname: PocketNotebook\ndescription: Keeps durable notes.\ncategory: productivity\ntags: [Notes]\n---\n\n## Soul\n\nYou are a notebook.\n',
    },
  ],
};

describe('init', () => {
  it('writes a document from the vendored template without touching the network', async () => {
    await withTempDir(async (dir) => {
      const io = recordingIo();
      // No api passed: a fake would still prove nothing, but a real client with no
      // route would throw if init reached for one, which is the assertion here.
      const code = await run(['init'], { io, cwd: dir, tty: false, env: {} });

      expect(code).toBe(0);
      const source = readFileSync(join(dir, 'agent.md'), 'utf8');
      expect(source).toContain('## Soul');
      expect(source).toContain('## Runtime');
      expect(io.text()).toContain('created');
    });
  });

  it('names the agent after the directory, so two projects cannot claim one id', async () => {
    await withTempDir(async (dir) => {
      const io = recordingIo();
      await run(['init', 'inbox-helper'], { io, cwd: dir, tty: false, env: {} });

      const source = readFileSync(join(dir, 'inbox-helper', 'agent.md'), 'utf8');
      expect(source).toContain('id: inbox-helper');
      expect(source).toContain('name: Inbox Helper');
      // The platform rejects the literal 'my-agent' as an unfilled placeholder, so
      // leaving it in would be a document that cannot deploy.
      expect(source).not.toContain('my-agent');
    });
  });

  it('leaves an existing document alone unless forced', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'agent.md'), 'mine\n', 'utf8');
      const io = recordingIo();

      await expect(run(['init'], { io, cwd: dir, tty: false, env: {} })).rejects.toThrow(
        /already exists/,
      );
      expect(readFileSync(join(dir, 'agent.md'), 'utf8')).toBe('mine\n');

      await run(['init', '--force'], { io, cwd: dir, tty: false, env: {} });
      expect(readFileSync(join(dir, 'agent.md'), 'utf8')).toContain('## Soul');
    });
  });

  it('keeps values and local state out of a commit', async () => {
    await withTempDir(async (dir) => {
      await run(['init'], { io: recordingIo(), cwd: dir, tty: false, env: {} });
      const ignore = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n');
      expect(ignore).toContain('.env');
      expect(ignore).toContain('.agentspaces/');
    });
  });

  it('fetches a platform template and renames it to the target directory', async () => {
    await withTempDir(async (dir) => {
      const { client, calls } = fakeApi({ '/agents/blueprints/examples': { body: EXAMPLES } });
      const io = recordingIo();

      await run(['init', 'notes', '--template', '01-minimal'], {
        io,
        cwd: dir,
        tty: false,
        env: {},
        api: client,
      });

      expect(calls).toHaveLength(1);
      const source = readFileSync(join(dir, 'notes', 'agent.md'), 'utf8');
      expect(source).toContain('id: notes');
      expect(source).toContain('You are a notebook.');
    });
  });

  it('lists the templates it does have when asked for one it does not', async () => {
    await withTempDir(async (dir) => {
      const { client } = fakeApi({ '/agents/blueprints/examples': { body: EXAMPLES } });
      await expect(
        run(['init', '--template', 'nope'], {
          io: recordingIo(),
          cwd: dir,
          tty: false,
          env: {},
          api: client,
        }),
      ).rejects.toThrow(/No template called 'nope'/);
    });
  });
});
