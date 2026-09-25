import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { answersFrom, readEnvScript, resolvePlaceholders, toCamelCase } from '../src/local.js';
import type { Shell, ShellResult } from '../src/local.js';
import { run } from '../src/run.js';
import { fakeApi, recordingIo, withTempDir } from './helpers.js';

const RUNTIMES = {
  data: [
    {
      brain: 'hermes',
      image: 'nousresearch/hermes-agent',
      verified: [{ release: 'v2026.8.31', image: 'nousresearch/hermes-agent:v2026.8.31' }],
    },
    { brain: 'openclaw', image: 'ghcr.io/openclaw/openclaw:2026.8.1' },
  ],
};

interface Docker {
  shell: Shell;
  /** Every invocation, joined, so a test can assert on the command line as read. */
  lines: string[];
  /** What was piped in, in order: the contents of each file written. */
  stdins: string[];
}

/**
 * A Docker that answers the way the real images do.
 *
 * Transcribed from `docker inspect` of the two pinned images: hermes publishes
 * `HERMES_HOME` and its data directory belongs to uid 10000, openclaw publishes no
 * home variable and runs as `node`. A suite that needed a container engine would fail
 * in CI and on a laptop with Docker Desktop closed, which is not what it would be
 * testing.
 */
function fakeDocker(options: { home?: string; owner?: string; exists?: boolean } = {}): Docker {
  const lines: string[] = [];
  const stdins: string[] = [];
  const ok = (stdout = ''): ShellResult => ({ stdout, stderr: '', code: 0 });

  const shell: Shell = async (args, stdin) => {
    lines.push(args.join(' '));
    if (stdin !== undefined) stdins.push(stdin);

    if (args[0] === 'inspect') return options.exists ? ok('running\n') : { stdout: '', stderr: 'No such object', code: 1 };
    if (args.includes('printenv')) {
      const variable = args[args.length - 1];
      if (variable === 'HERMES_HOME') {
        return options.home === undefined
          ? { stdout: '', stderr: '', code: 1 }
          : ok(`${options.home}\n`);
      }
      return ok('/home/node\n');
    }
    if (args.includes('stat')) return ok(`${options.owner ?? '10000:10000'}\n`);
    return ok();
  };

  return { shell, lines, stdins };
}

/** A project with one of everything a local run has to place. */
function project(dir: string, extra: Record<string, string> = {}): void {
  writeFileSync(
    join(dir, 'agent.yaml'),
    'id: standup-log\nname: Standup Log\nbrain: hermes\n',
    'utf8',
  );
  writeFileSync(join(dir, 'soul.md'), 'You keep the standup log for {{teamName}}.\n', 'utf8');
  writeFileSync(join(dir, '.env'), 'TEAM_NAME={{teamName}}\nLLM_KEY={{llmApiKey}}\n', 'utf8');
  writeFileSync(join(dir, 'setup.sh'), 'mkdir -p standup\n', 'utf8');
  writeFileSync(join(dir, 'test.yaml'), 'command: timeout 30 {{home}}/scripts/log.sh --selftest\n', 'utf8');
  mkdirSync(join(dir, 'files', 'home', 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'files', 'home', 'scripts', 'log.sh'), 'echo "$TEAM_NAME"\n', 'utf8');
  for (const [name, contents] of Object.entries(extra)) {
    writeFileSync(join(dir, name), contents, 'utf8');
  }
}

describe('run', () => {
  it('places the project in the image the platform pins, as the user the agent is', async () => {
    await withTempDir(async (dir) => {
      project(dir, { '.env.local': 'TEAM_NAME=Platform\nLLM_KEY=local-only-value\n' });
      const docker = fakeDocker({ home: '/opt/data' });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });
      const io = recordingIo();

      await run(['run'], { io, cwd: dir, tty: false, env: {}, api: client, shell: docker.shell });
      const text = io.text();
      const docker_ = docker.lines.join('\n');

      // The pin, not the floating tag: a local run against some other build of the
      // runtime has proved nothing about the one about to be deployed.
      expect(docker_).toContain('nousresearch/hermes-agent:v2026.8.31');
      // Idle, so the project is in place before the agent reads anything.
      expect(docker_).toContain('run --detach --name agentkit-standup-log');
      expect(docker_).toContain('sleep infinity');

      // `{{home}}` is the runtime's answer, which is why files/home/ exists at all.
      expect(text).toContain('/opt/data/scripts/log.sh');
      expect(text).toContain('/opt/data/SOUL.md');
      expect(text).toContain('/opt/data/.env');

      // Both of the failures this command is careful about: a file owned by root that
      // the agent cannot read, and a check run as root that would not notice.
      expect(docker_).toContain('chown -R');
      expect(docker_).toContain('exec --user 10000:10000 agentkit-standup-log');
    });
  });

  it('fills the placeholders from .env.local and reports the ones nobody answered', async () => {
    await withTempDir(async (dir) => {
      project(dir, { '.env.local': 'TEAM_NAME=Platform\n' });
      const docker = fakeDocker({ home: '/opt/data' });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });
      const io = recordingIo();

      await run(['run'], { io, cwd: dir, tty: false, env: {}, api: client, shell: docker.shell });

      // TEAM_NAME is the environment's spelling of {{teamName}}, and answers the soul.
      expect(docker.stdins.join('\n')).toContain('You keep the standup log for Platform.');
      // The unanswered one is left standing rather than blanked, and named.
      expect(docker.stdins.join('\n')).toContain('LLM_KEY={{llmApiKey}}');
      expect(io.text()).toContain('unanswered');
      expect(io.text()).toContain('llmApiKey');
    });
  });

  it('comments out an unanswered variable, because the environment gets sourced', async () => {
    await withTempDir(async (dir) => {
      project(dir, { '.env.local': 'TEAM_NAME=Platform\n' });
      // Found by running this for real: a line left as `KEY={{a | b}}` is a shell
      // syntax error, and it takes every line after it in the file down with it.
      writeFileSync(join(dir, '.env'), 'MODEL={{llmModel | defaultModel}}\nTEAM_NAME={{teamName}}\n', 'utf8');
      const docker = fakeDocker({ home: '/opt/data' });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });
      const io = recordingIo();

      await run(['run'], { io, cwd: dir, tty: false, env: {}, api: client, shell: docker.shell });

      const written = docker.stdins.join('\n');
      expect(written).toContain('# MODEL={{llmModel | defaultModel}}');
      expect(written).toContain('TEAM_NAME=Platform');
      // Named by the field an author would answer, not by the platform's fallback.
      expect(io.text()).toContain('unanswered  llmModel');
    });
  });

  it('keeps a local-only variable that the project never declared', async () => {
    await withTempDir(async (dir) => {
      project(dir, { '.env.local': 'TEAM_NAME=Platform\nHERMES_DEBUG=1\n' });
      const docker = fakeDocker({ home: '/opt/data' });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });

      await run(['run'], {
        io: recordingIo(),
        cwd: dir,
        tty: false,
        env: {},
        api: client,
        shell: docker.shell,
      });

      const written = docker.stdins.join('\n');
      expect(written).toContain('HERMES_DEBUG=1');
      // And the declared one keeps the project's spelling, not a second copy of it.
      expect(written.match(/TEAM_NAME=/g)).toHaveLength(1);
    });
  });

  it('runs the project’s own test inside the container when asked', async () => {
    await withTempDir(async (dir) => {
      project(dir, { '.env.local': 'TEAM_NAME=Platform\n' });
      const docker = fakeDocker({ home: '/opt/data' });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });
      const io = recordingIo();

      await run(['run', '--test'], {
        io,
        cwd: dir,
        tty: false,
        env: {},
        api: client,
        shell: docker.shell,
      });

      expect(io.text()).toContain('timeout 30 /opt/data/scripts/log.sh --selftest');
      // The environment comes with it, because .env is a file the runtime reads for
      // itself and a command run beside the runtime gets nothing from it otherwise.
      expect(docker.lines.join('\n')).toContain('done < .env');
      // Read, never sourced. See the suite below for why that distinction matters.
      expect(docker.lines.join('\n')).not.toContain('. ./.env');
    });
  });

  it('says so rather than inventing a test for a project that declares none', async () => {
    await withTempDir(async (dir) => {
      project(dir);
      writeFileSync(join(dir, 'test.yaml'), '', 'utf8');
      const docker = fakeDocker({ home: '/opt/data' });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });

      await expect(
        run(['run', '--test'], {
          io: recordingIo(),
          cwd: dir,
          tty: false,
          env: {},
          api: client,
          shell: docker.shell,
        }),
      ).rejects.toThrow(/declares no test/);
    });
  });

  it('writes an openclaw project under the container user’s own home', async () => {
    await withTempDir(async (dir) => {
      project(dir);
      writeFileSync(join(dir, 'agent.yaml'), 'id: scout\nbrain: openclaw\n', 'utf8');
      // No HERMES_HOME in this image, so the directory is resolved from $HOME.
      const docker = fakeDocker({ owner: '1000:1000' });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });
      const io = recordingIo();

      await run(['run'], { io, cwd: dir, tty: false, env: {}, api: client, shell: docker.shell });

      expect(io.text()).toContain('/home/node/.openclaw');
      // Each runtime reads its instructions from its own path, and this is the whole
      // difference between the two as far as a project is concerned.
      expect(io.text()).toContain('/home/node/.openclaw/workspace/AGENTS.md');
      expect(docker.lines.join('\n')).toContain('exec --user 1000:1000 agentkit-scout');
    });
  });

  it('replaces a container left from the last run rather than writing over it', async () => {
    await withTempDir(async (dir) => {
      project(dir);
      const docker = fakeDocker({ home: '/opt/data', exists: true });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });

      await run(['run'], {
        io: recordingIo(),
        cwd: dir,
        tty: false,
        env: {},
        api: client,
        shell: docker.shell,
      });

      const removed = docker.lines.findIndex((line) => line.startsWith('rm --force'));
      const started = docker.lines.findIndex((line) => line.startsWith('run --detach'));
      expect(removed).toBeGreaterThan(-1);
      expect(removed).toBeLessThan(started);
    });
  });

  it('takes the container down without asking the platform anything', async () => {
    await withTempDir(async (dir) => {
      project(dir);
      const docker = fakeDocker({ home: '/opt/data', exists: true });
      const { client, calls } = fakeApi({});
      const io = recordingIo();

      await run(['run', '--down'], {
        io,
        cwd: dir,
        tty: false,
        env: {},
        api: client,
        shell: docker.shell,
      });

      expect(docker.lines).toEqual(['rm --force --volumes agentkit-standup-log']);
      expect(calls).toHaveLength(0);
      expect(io.text()).toContain('removed');
    });
  });

  it('skips the network entirely when the image is given', async () => {
    await withTempDir(async (dir) => {
      project(dir);
      const docker = fakeDocker({ home: '/opt/data' });
      const { client, calls } = fakeApi({});

      await run(['run', '--image', 'hermes-agent:local-build'], {
        io: recordingIo(),
        cwd: dir,
        tty: false,
        env: {},
        api: client,
        shell: docker.shell,
      });

      expect(calls).toHaveLength(0);
      expect(docker.lines.join('\n')).toContain('hermes-agent:local-build');
    });
  });

  it('refuses a document, which would need the parser this package does not have', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'agent.md'), '---\nid: scout\n---\n\n## Soul\n\nYou scout.\n', 'utf8');

      await expect(
        run(['run'], { io: recordingIo(), cwd: dir, tty: false, env: {}, shell: fakeDocker().shell }),
      ).rejects.toMatchObject({ exitCode: 2, hint: expect.stringContaining('agent init') });
    });
  });

  it('names the runtimes it can run rather than starting a container it cannot fill', async () => {
    await withTempDir(async (dir) => {
      project(dir);
      writeFileSync(join(dir, 'agent.yaml'), 'id: scout\nbrain: something-else\n', 'utf8');
      const docker = fakeDocker();

      await expect(
        run(['run'], { io: recordingIo(), cwd: dir, tty: false, env: {}, shell: docker.shell }),
      ).rejects.toThrow(/No local runtime for brain 'something-else'/);
      expect(docker.lines).toEqual([]);
    });
  });

  it('reports the whole run as one object under --json', async () => {
    await withTempDir(async (dir) => {
      project(dir, { '.env.local': 'TEAM_NAME=Platform\n' });
      const docker = fakeDocker({ home: '/opt/data' });
      const { client } = fakeApi({ '/agents/runtimes': { body: RUNTIMES } });
      const io = recordingIo();

      await run(['run', '--test', '--json'], {
        io,
        cwd: dir,
        tty: false,
        env: {},
        api: client,
        shell: docker.shell,
      });
      const report = JSON.parse(io.text()) as {
        container: string;
        home: string;
        user: string;
        placed: string[];
        unanswered: string[];
        setup: { code: number };
        test: { command: string; code: number };
      };

      expect(report.container).toBe('agentkit-standup-log');
      expect(report.home).toBe('/opt/data');
      expect(report.user).toBe('10000:10000');
      expect(report.placed).toContain('/opt/data/SOUL.md');
      expect(report.unanswered).toEqual(['llmApiKey']);
      expect(report.setup.code).toBe(0);
      expect(report.test.command).toContain('/opt/data/scripts/log.sh');
    });
  });
});

/**
 * The one thing a fake Docker cannot check: whether the shell this module writes is
 * correct shell. It is POSIX sh either way, so it runs here.
 */
describe('the environment a command is given', () => {
  const load = (dir: string, env: string, print: string): string => {
    writeFileSync(join(dir, '.env'), env, 'utf8');
    return execFileSync('sh', ['-c', `${readEnvScript()}\n${print}`], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  };

  it('keeps a value with a space in it, which sourcing the file silently empties', async () => {
    await withTempDir(async (dir) => {
      // Sourcing `TEAM_NAME=Platform Engineering` leaves TEAM_NAME empty and prints
      // `Engineering: not found`, while the runtime's own reader gets both words. That
      // divergence is the opposite of what a local run is for.
      expect(load(dir, 'TEAM_NAME=Platform Engineering\n', 'echo "[$TEAM_NAME]"')).toBe(
        '[Platform Engineering]',
      );
    });
  });

  it('leaves a value alone rather than expanding it, the way dotenv does', async () => {
    await withTempDir(async (dir) => {
      // A key or a password with a `$` in it is ordinary, and sourcing eats it.
      expect(load(dir, 'SECRET=a$NOT_SET-b\n', 'echo "[$SECRET]"')).toBe('[a$NOT_SET-b]');
    });
  });

  it('takes one layer of surrounding quotes off, also the way dotenv does', async () => {
    await withTempDir(async (dir) => {
      const out = load(
        dir,
        'DOUBLE="two words"\nSINGLE=\'two words\'\nINNER=say "hi"\n',
        'echo "[$DOUBLE][$SINGLE][$INNER]"',
      );
      expect(out).toBe('[two words][two words][say "hi"]');
    });
  });

  it('skips comments, blanks and anything that is not a pair', async () => {
    await withTempDir(async (dir) => {
      expect(load(dir, '# a note\n\nnot a pair\nKEY=value\n', 'echo "[$KEY]"')).toBe('[value]');
    });
  });

  it('reads a last line that has no newline after it', async () => {
    await withTempDir(async (dir) => {
      expect(load(dir, 'KEY=value', 'echo "[$KEY]"')).toBe('[value]');
    });
  });

  it('does nothing at all when there is no environment file', async () => {
    await withTempDir(async (dir) => {
      expect(
        execFileSync('sh', ['-c', `${readEnvScript()}\necho done`], {
          cwd: dir,
          encoding: 'utf8',
        }).trim(),
      ).toBe('done');
    });
  });
});

describe('placeholders in a local run', () => {
  it('prefers an answer, falls back to a quoted default, and leaves the rest standing', () => {
    const answers = new Map([['teamName', 'Platform']]);
    expect(resolvePlaceholders('{{teamName}}', answers).text).toBe('Platform');
    expect(resolvePlaceholders('{{missing | "the team"}}', answers).text).toBe('the team');

    const left = resolvePlaceholders('key={{llmApiKey}}', answers);
    expect(left.text).toBe('key={{llmApiKey}}');
    expect(left.unresolved).toEqual(['llmApiKey']);
  });

  it('reads an environment file as answers under both spellings', () => {
    const answers = answersFrom('# a note\nTEAM_NAME=Platform\nEMPTY=\nnot a pair\n');
    expect(answers.get('TEAM_NAME')).toBe('Platform');
    expect(answers.get('teamName')).toBe('Platform');
    expect(answers.has('not a pair')).toBe(false);
    expect(toCamelCase('LLM_API_KEY')).toBe('llmApiKey');
  });
});
