import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { recordingIo, withTempDir } from './helpers.js';

function scaffolded(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yaml'), 'id: notes\nname: Notes\n', 'utf8');
  writeFileSync(join(dir, 'soul.md'), '# Soul\n\nYou keep notes.\n', 'utf8');
}

describe('build', () => {
  it('writes the compiled document where a commit will not pick it up', async () => {
    await withTempDir(async (dir) => {
      scaffolded(dir);
      const io = recordingIo();

      const code = await run(['build'], { io, cwd: dir, tty: false, env: {} });

      expect(code).toBe(0);
      const built = readFileSync(join(dir, '.agentspaces', 'agent.md'), 'utf8');
      expect(built).toContain('id: notes');
      expect(built).toContain('## Soul');
      // init gitignores .agentspaces/, so this is an artefact rather than a file to edit.
      expect(io.text()).toContain('.agentspaces/agent.md');
    });
  });

  it('prints the document and writes nothing under --emit, so it can be piped', async () => {
    await withTempDir(async (dir) => {
      scaffolded(dir);
      const io = recordingIo();

      await run(['build', '--emit'], { io, cwd: dir, tty: false, env: {} });

      expect(io.text().startsWith('---')).toBe(true);
      expect(io.text()).toContain('You keep notes.');
      expect(existsSync(join(dir, '.agentspaces'))).toBe(false);
    });
  });

  it('reports the files it read under --json', async () => {
    await withTempDir(async (dir) => {
      const io = recordingIo();
      scaffolded(dir);

      await run(['build', '--json'], { io, cwd: dir, tty: false, env: {} });

      expect(JSON.parse(io.text())).toMatchObject({
        path: join(dir, '.agentspaces', 'agent.md'),
        kind: 'project',
        inputs: ['agent.yaml', 'soul.md'],
      });
    });
  });

  it('builds a named project from somewhere else', async () => {
    await withTempDir(async (dir) => {
      scaffolded(join(dir, 'notes'));

      await run(['build', 'notes'], { io: recordingIo(), cwd: dir, tty: false, env: {} });

      // Beside the project it belongs to, not beside whoever ran the command.
      expect(existsSync(join(dir, 'notes', '.agentspaces', 'agent.md'))).toBe(true);
      expect(existsSync(join(dir, '.agentspaces'))).toBe(false);
    });
  });
});
