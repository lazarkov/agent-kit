import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { run } from '../src/run.js';
import { fakeApi, recordingIo, withTempDir } from './helpers.js';

/** A preview transcribed from a live `POST /agents/blueprints/validate`. */
const PREVIEW = {
  data: {
    id: 'inbox-helper',
    name: 'Inbox Helper',
    description: 'Sorts a support inbox every half hour.',
    category: 'productivity',
    tags: ['Starter'],
    kind: 'shared',
    origin: null,
    steps: [{ id: 'llm', panel: 'llm', label: 'LLM Provider', description: 'Bring your own key' }],
    config: [
      { key: 'llmApiKey', label: 'LLM API Key', type: 'string', required: true, sensitive: true },
    ],
    envKeys: ['LLM_PROVIDER', '{{llmKeyVar}}'],
    files: [],
    setup: [],
    diagnostics: [],
    soulLines: 23,
    runtime: { defaultModel: 'anthropic/claude-sonnet-4.6', toolsets: ['terminal'] },
    brain: 'hermes',
    soul: '# Soul\n\nYou are a careful assistant.',
    schedule: [],
    toolsets: [
      { key: 'terminal', label: 'Terminal & Processes', tools: 'run commands', enabled: true },
      { key: 'web', label: 'Web', tools: 'fetch pages', enabled: false },
    ],
  },
};

const DOCUMENT = '---\nid: inbox-helper\nname: Inbox Helper\n---\n\n## Soul\n\nYou are careful.\n';

describe('validate', () => {
  it('sends the document and reports what would be built', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'agent.md'), DOCUMENT, 'utf8');
      const { client, calls } = fakeApi({ '/agents/blueprints/validate': { body: PREVIEW } });
      const io = recordingIo();

      await run(['validate'], { io, cwd: dir, tty: false, env: {}, api: client });

      expect(calls[0]).toMatchObject({
        method: 'POST',
        url: '/agents/blueprints/validate',
        body: { source: DOCUMENT },
      });
      expect(io.text()).toContain('valid');
      expect(io.text()).toContain('anthropic/claude-sonnet-4.6');
    });
  });

  it('says what to run when there is no document here', async () => {
    await withTempDir(async (dir) => {
      await expect(
        run(['validate'], { io: recordingIo(), cwd: dir, tty: false, env: {} }),
      ).rejects.toMatchObject({ exitCode: 2, hint: expect.stringContaining('agent init') });
    });
  });

  it('refuses a document larger than the platform accepts before sending it', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'agent.md'), 'x'.repeat(65 * 1024), 'utf8');
      const { client, calls } = fakeApi({});

      await expect(
        run(['validate'], { io: recordingIo(), cwd: dir, tty: false, env: {}, api: client }),
      ).rejects.toThrow(/the limit is 64 KB/);
      expect(calls).toHaveLength(0);
    });
  });

  it('prints the preview verbatim under --json', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'agent.md'), DOCUMENT, 'utf8');
      const { client } = fakeApi({ '/agents/blueprints/validate': { body: PREVIEW } });
      const io = recordingIo();

      await run(['validate', '--json'], { io, cwd: dir, tty: false, env: {}, api: client });

      expect(JSON.parse(io.text())).toEqual(PREVIEW.data);
    });
  });
});

describe('explain', () => {
  it('reads out the wizard, the withheld tools and the templated env name', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'agent.md'), DOCUMENT, 'utf8');
      const { client } = fakeApi({ '/agents/blueprints/validate': { body: PREVIEW } });
      const io = recordingIo();

      await run(['explain'], { io, cwd: dir, tty: false, env: {}, api: client });
      const text = io.text();

      expect(text).toContain('LLM Provider');
      expect(text).toContain('withheld');
      expect(text).toContain('resolves when the agent is created');
      expect(text).toContain('acts when it is spoken to');
    });
  });

  it('reads out the files, setup and schedule of a document that has them', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'agent.md'), DOCUMENT, 'utf8');
      const { client } = fakeApi({
        '/agents/blueprints/validate': {
          body: {
            data: {
              ...PREVIEW.data,
              files: ['notes/README.md'],
              setup: ['mkdir -p notes'],
              schedule: [{ name: 'morning', cron: '0 7 * * *', deliver: 'telegram:owner' }],
            },
          },
        },
      });
      const io = recordingIo();

      await run(['explain'], { io, cwd: dir, tty: false, env: {}, api: client });
      const text = io.text();

      expect(text).toContain('notes/README.md');
      expect(text).toContain('mkdir -p notes');
      expect(text).toContain('morning');
      expect(text).toContain('telegram:owner');
      // With a schedule, the "only when spoken to" line would be wrong.
      expect(text).not.toContain('acts when it is spoken to');
    });
  });

  it('takes the document as --file as well as positionally', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'other.md'), DOCUMENT, 'utf8');
      const { client, calls } = fakeApi({ '/agents/blueprints/validate': { body: PREVIEW } });

      await run(['explain', '--file', 'other.md'], {
        io: recordingIo(),
        cwd: dir,
        tty: false,
        env: {},
        api: client,
      });

      expect(calls[0]?.body).toEqual({ source: DOCUMENT });
    });
  });
});

describe('templates', () => {
  const EXAMPLES = {
    data: [
      {
        slug: '01-minimal',
        name: 'PocketNotebook',
        description: 'Keeps durable notes in its own container.',
        sections: ['Config', 'Soul'],
        source: '---\nid: pocket-notebook\n---\n\n## Soul\n\nYou are a notebook.\n',
      },
      {
        slug: '04-everything',
        name: 'WeatherMarketScout',
        description: 'Watches weather-driven prediction markets.',
        sections: ['Config', 'Schedule', 'Soul'],
        source: '---\nid: weather-scout\n---\n\n## Soul\n\nYou watch markets.\n',
      },
    ],
  };

  it('lists them in the order they arrive, which is the order they teach in', async () => {
    const { client } = fakeApi({ '/agents/blueprints/examples': { body: EXAMPLES } });
    const io = recordingIo();

    await run(['templates'], { io, cwd: '/tmp', tty: false, env: {}, api: client });
    const text = io.text();

    expect(io.lines[0]).toContain('01-minimal');
    expect(text.indexOf('01-minimal')).toBeLessThan(text.indexOf('04-everything'));
    expect(text).toContain('Config, Schedule, Soul');
    expect(text).toContain('agent init --template 01-minimal');
  });

  it('leaves the four whole documents out of --json, since this is a list', async () => {
    const { client } = fakeApi({ '/agents/blueprints/examples': { body: EXAMPLES } });
    const io = recordingIo();

    await run(['templates', '--json'], { io, cwd: '/tmp', tty: false, env: {}, api: client });
    const parsed = JSON.parse(io.text()) as { slug: string; source?: string }[];

    expect(parsed.map((example) => example.slug)).toEqual(['01-minimal', '04-everything']);
    expect(parsed[0]?.source).toBeUndefined();
  });
});

describe('models', () => {
  const MODELS = {
    provider: 'openrouter',
    models: [
      { id: 'paid/one', promptPrice: 0.000004, contextLength: 1_000_000, toolCapable: true },
      { id: 'free/two', promptPrice: 0, free: true, contextLength: 128_000, toolCapable: true },
      { id: 'blind/three', promptPrice: 0.0000001, toolCapable: false },
    ],
  };

  it('puts the cheapest first and marks what cannot call tools', async () => {
    const { client, calls } = fakeApi({ '/agents/llm-models': { body: MODELS } });
    const io = recordingIo();

    await run(['models', '--provider', 'openrouter'], {
      io,
      cwd: '/tmp',
      tty: false,
      env: {},
      api: client,
    });

    expect(calls[0]?.body).toEqual({ provider: 'openrouter' });
    expect(io.lines[0]).toContain('free/two');
    expect(io.text()).toContain('free');
    expect(io.text()).toContain('no tools');
  });

  it('filters to the free and tool-capable ones when asked', async () => {
    const { client } = fakeApi({ '/agents/llm-models': { body: MODELS } });
    const io = recordingIo();

    await run(['models', 'openrouter', '--free', '--tools', '--json'], {
      io,
      cwd: '/tmp',
      tty: false,
      env: {},
      api: client,
    });

    expect(JSON.parse(io.text()).models.map((model: { id: string }) => model.id)).toEqual([
      'free/two',
    ]);
  });

  it('asks which provider rather than guessing one', async () => {
    await expect(
      run(['models'], { io: recordingIo(), cwd: '/tmp', tty: false, env: {} }),
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  it('never writes a key it was handed anywhere but the request', async () => {
    const { client, calls } = fakeApi({ '/agents/llm-models': { body: MODELS } });
    const io = recordingIo();

    await run(['models', '--provider', 'openrouter', '--key', 'test-key-value'], {
      io,
      cwd: '/tmp',
      tty: false,
      env: {},
      api: client,
    });

    expect(calls[0]?.body).toEqual({ provider: 'openrouter', apiKey: 'test-key-value' });
    expect(io.text()).not.toContain('test-key-value');
  });

  it('falls back to LLM_API_KEY from the environment, so a key need not be typed', async () => {
    const { client, calls } = fakeApi({ '/agents/llm-models': { body: MODELS } });

    await run(['models', '--provider', 'anthropic'], {
      io: recordingIo(),
      cwd: '/tmp',
      tty: false,
      env: { LLM_API_KEY: 'from-env' },
      api: client,
    });

    expect(calls[0]?.body).toEqual({ provider: 'anthropic', apiKey: 'from-env' });
  });

  it('says so plainly when the filters leave nothing', async () => {
    const { client } = fakeApi({
      '/agents/llm-models': { body: { provider: 'anthropic', models: [] } },
    });
    const io = recordingIo();

    await run(['models', '--provider', 'anthropic'], {
      io,
      cwd: '/tmp',
      tty: false,
      env: {},
      api: client,
    });

    expect(io.text()).toContain('No models matched for anthropic');
  });
});

describe('runtimes', () => {
  it('shows the pinned image and notes when upstream has moved past it', async () => {
    const { client } = fakeApi({
      '/agents/runtimes': {
        body: {
          data: [
            {
              brain: 'hermes',
              image: 'nousresearch/hermes-agent',
              repo: 'NousResearch/hermes-agent',
              verified: [
                {
                  release: 'v2026.8.31',
                  image: 'nousresearch/hermes-agent:v2026.8.31',
                  checkedAt: '2026-09-02',
                  note: 'Bot Mode, a v0.21.0 feature.',
                },
              ],
              upstream: { release: 'v2026.9.24', verified: false },
            },
          ],
        },
      },
    });
    const io = recordingIo();

    await run(['runtimes'], { io, cwd: '/tmp', tty: false, env: {}, api: client });

    expect(io.text()).toContain('nousresearch/hermes-agent:v2026.8.31');
    expect(io.text()).toContain('v2026.9.24');
    expect(io.text()).toContain('not yet verified here');
  });
});

describe('search', () => {
  const TYPES = {
    data: [
      {
        id: 'ab-test-analyzer',
        name: 'A/B Test Analyzer',
        description: 'A rigorous experimentation analyst.',
        category: 'marketing',
        tags: ['Marketing'],
        verified: false,
        brain: 'hermes',
      },
      {
        id: 'media-company',
        name: 'Media Company',
        description: 'Runs an editorial board.',
        category: 'marketing',
        tags: ['Content'],
        verified: true,
        brain: 'openclaw',
        hasTest: true,
      },
    ],
  };

  it('matches every term across id, name, description and tags', async () => {
    const { client } = fakeApi({ '/agents/types': { body: TYPES } });
    const io = recordingIo();

    await run(['search', 'editorial', 'board', '--json'], {
      io,
      cwd: '/tmp',
      tty: false,
      env: {},
      api: client,
    });

    expect(JSON.parse(io.text()).map((type: { id: string }) => type.id)).toEqual(['media-company']);
  });

  it('puts the ones somebody has actually run first', async () => {
    const { client } = fakeApi({ '/agents/types': { body: TYPES } });
    const io = recordingIo();

    await run(['search'], { io, cwd: '/tmp', tty: false, env: {}, api: client });

    expect(io.lines[0]).toContain('media-company');
    expect(io.text()).toContain('verified');
  });

  it('combines --verified with --brain', async () => {
    const { client } = fakeApi({ '/agents/types': { body: TYPES } });

    const openclaw = recordingIo();
    await run(['search', '--verified', '--brain', 'openclaw', '--json'], {
      io: openclaw,
      cwd: '/tmp',
      tty: false,
      env: {},
      api: client,
    });
    expect(JSON.parse(openclaw.text()).map((type: { id: string }) => type.id)).toEqual([
      'media-company',
    ]);

    // The one hermes agent here is unverified, so the pair of filters excludes it —
    // and the brain's value must not leak into the query to make that happen.
    const hermes = recordingIo();
    await run(['search', '--verified', '--brain', 'hermes', '--json'], {
      io: hermes,
      cwd: '/tmp',
      tty: false,
      env: {},
      api: client,
    });
    expect(JSON.parse(hermes.text())).toEqual([]);
  });

  it('filters by category', async () => {
    const { client } = fakeApi({
      '/agents/types': {
        body: { data: [...TYPES.data, { id: 'note-taker', name: 'Notes', description: '', category: 'productivity' }] },
      },
    });
    const io = recordingIo();

    await run(['search', '--category', 'productivity', '--json'], {
      io,
      cwd: '/tmp',
      tty: false,
      env: {},
      api: client,
    });

    expect(JSON.parse(io.text()).map((type: { id: string }) => type.id)).toEqual(['note-taker']);
  });

  it('shows a page, says how many it held back, and gives them all up on --all', async () => {
    const many = {
      data: Array.from({ length: 25 }, (_, index) => ({
        id: `agent-${index}`,
        name: `Agent ${index}`,
        description: 'One of many.',
      })),
    };
    const { client } = fakeApi({ '/agents/types': { body: many } });

    const paged = recordingIo();
    await run(['search'], { io: paged, cwd: '/tmp', tty: false, env: {}, api: client });
    expect(paged.text()).toContain('showing 20');
    expect(paged.text()).not.toContain('agent-24');

    const all = recordingIo();
    await run(['search', '--all'], { io: all, cwd: '/tmp', tty: false, env: {}, api: client });
    expect(all.text()).toContain('agent-24');
    expect(all.text()).not.toContain('showing');
  });

  it('says how big the catalogue was when nothing matched', async () => {
    const { client } = fakeApi({ '/agents/types': { body: TYPES } });
    const io = recordingIo();

    await run(['search', 'nothing-like-this'], { io, cwd: '/tmp', tty: false, env: {}, api: client });

    expect(io.text()).toContain('Nothing matched');
    expect(io.text()).toContain('2 agents in the catalogue');
  });
});

describe('doctor', () => {
  it('passes with a reachable api and no document', async () => {
    await withTempDir(async (dir) => {
      const { client } = fakeApi({
        '/agents/runtimes': { body: { data: [{ brain: 'hermes', image: 'x' }] } },
      });
      const io = recordingIo();

      const code = await run(['doctor'], { io, cwd: dir, tty: false, env: {}, api: client });

      expect(code).toBe(0);
      expect(io.text()).toContain('ok');
      expect(io.text()).toContain("run 'agent init'");
    });
  });

  it('fails, with the reason, when the api refuses the document here', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'agent.md'), DOCUMENT, 'utf8');
      const { client } = fakeApi({
        '/agents/runtimes': { body: { data: [{ brain: 'hermes', image: 'x' }] } },
        '/agents/blueprints/validate': {
          status: 400,
          body: { code: 'BLUEPRINT_INVALID', message: "no '## Soul' section" },
        },
      });
      const io = recordingIo();

      await expect(
        run(['doctor'], { io, cwd: dir, tty: false, env: {}, api: client }),
      ).rejects.toThrow(/check\(s\) failed: document/);
      expect(io.text()).toContain("no '## Soul' section");
    });
  });

  it('reports every check under --json, for a CI step that keeps the output', async () => {
    await withTempDir(async (dir) => {
      const { client } = fakeApi({
        '/agents/runtimes': { body: { data: [{ brain: 'hermes', image: 'x' }] } },
      });
      const io = recordingIo();

      await run(['doctor', '--json'], { io, cwd: dir, tty: false, env: {}, api: client });
      const report = JSON.parse(io.text()) as {
        ok: boolean;
        checks: { name: string; ok: boolean }[];
      };

      expect(report.ok).toBe(true);
      expect(report.checks.map((check) => check.name)).toEqual(['node', 'api', 'document']);
    });
  });

  it('fails when the api cannot be reached at all', async () => {
    await withTempDir(async (dir) => {
      const { client } = fakeApi({});
      await expect(
        run(['doctor'], { io: recordingIo(), cwd: dir, tty: false, env: {}, api: client }),
      ).rejects.toThrow(/check\(s\) failed: api/);
    });
  });
});

describe('help and version', () => {
  it('prints help with no arguments and exits zero', async () => {
    const io = recordingIo();
    const code = await run([], { io, cwd: '/tmp', tty: false, env: {} });
    expect(code).toBe(0);
    expect(io.text()).toContain('Usage');
    // The boundary is the thing worth being explicit about on the first screen.
    expect(io.text()).toContain('need an account');
  });

  it('refuses an unknown command and lists the real ones', async () => {
    await expect(
      run(['deploy'], { io: recordingIo(), cwd: '/tmp', tty: false, env: {} }),
    ).rejects.toMatchObject({ exitCode: 2, hint: expect.stringContaining('validate') });
  });

  it('reads the api address from the environment', async () => {
    const io = recordingIo();
    await expect(
      run(['runtimes'], {
        io,
        cwd: '/tmp',
        tty: false,
        env: { AGENTSPACES_API: 'http://127.0.0.1:9/api' },
      }),
    ).rejects.toThrow(/Could not reach http:\/\/127\.0\.0\.1:9\/api/);
  });
});
