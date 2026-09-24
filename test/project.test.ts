import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CliError } from '../src/errors.js';
import { compileProject, envToYaml, loadSource } from '../src/project.js';
import { withTempDir } from './helpers.js';

/** Writes a project, creating parent directories, and returns its root. */
function project(dir: string, files: Record<string, string>): string {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

const MANIFEST = 'id: notes\nversion: 0.1.0\nname: Notes\ncategory: productivity\n';

describe('compiling a project', () => {
  it('puts the manifest in the frontmatter and every file in its section', async () => {
    await withTempDir(async (dir) => {
      project(dir, {
        'agent.yaml': MANIFEST,
        'config.yaml': 'defaultModel: anthropic/claude-sonnet-4.6\n',
        'soul.md': '# Soul\n\nYou keep notes.\n',
      });

      const { source } = compileProject(dir);

      expect(source).toBe(
        [
          '---',
          'id: notes',
          'version: 0.1.0',
          'name: Notes',
          'category: productivity',
          '---',
          '',
          '## Runtime',
          '',
          '```yaml',
          'defaultModel: anthropic/claude-sonnet-4.6',
          '```',
          '',
          '## Soul',
          '',
          '# Soul',
          '',
          'You keep notes.',
          '',
        ].join('\n'),
      );
    });
  });

  it('leaves out the sections whose files are absent or empty', async () => {
    await withTempDir(async (dir) => {
      project(dir, {
        'agent.yaml': MANIFEST,
        'soul.md': 'You keep notes.\n',
        // Present but empty: an author who has not written their setup yet should not
        // ship an empty Setup section for the platform to reject.
        'setup.sh': '\n\n',
      });

      const { source, inputs } = compileProject(dir);
      expect(source).not.toContain('## Setup');
      expect(source).not.toContain('## Schedule');
      expect(inputs).toEqual(['agent.yaml', 'soul.md']);
    });
  });

  it('keeps the sections in the order the platform documents them', async () => {
    await withTempDir(async (dir) => {
      project(dir, {
        'agent.yaml': MANIFEST,
        'soul.md': 'You keep notes.\n',
        'fields.yaml': '- key: apiKey\n',
        'onboarding.yaml': '- id: llm\n',
        '.env': 'A=b\n',
        'config.yaml': 'defaultModel: x\n',
        'schedule.yaml': '- name: nightly\n',
        'setup.sh': 'mkdir -p {{home}}/notes\n',
        'test.yaml': 'command: true\n',
        'diagnostics.yaml': '- key: disk\n',
        'files/home/notes/README.md': 'notes\n',
      });

      const { source } = compileProject(dir);
      const order = [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
      expect(order).toEqual([
        'Config',
        'Onboarding',
        'Environment',
        'Runtime',
        'Schedule',
        'Setup',
        'Test',
        'Diagnostics',
        'Files',
        'Soul',
      ]);
    });
  });

  it('maps files/home to the runtime’s own directory and everything else to an absolute path', async () => {
    await withTempDir(async (dir) => {
      project(dir, {
        'agent.yaml': MANIFEST,
        'files/home/notes/README.md': 'One file per subject.\n',
        'files/etc/agent/rules.toml': 'strict = true\n',
      });

      const { source } = compileProject(dir);
      expect(source).toContain('### {{home}}/notes/README.md');
      expect(source).toContain('### /etc/agent/rules.toml');
      expect(source).toContain('```toml\nstrict = true\n```');
    });
  });

  it('reads a .when sidecar as the condition on its file, not as a file of its own', async () => {
    await withTempDir(async (dir) => {
      project(dir, {
        'agent.yaml': MANIFEST,
        'files/home/telegram.json': '{"token": "{{telegramToken}}"}\n',
        'files/home/telegram.json.when': 'telegramToken\n',
      });

      const { source, inputs } = compileProject(dir);
      expect(source).toContain('### {{home}}/telegram.json\nwhen: telegramToken\n');
      expect(source).not.toContain('telegram.json.when');
      expect(inputs).toEqual(['agent.yaml', 'files/home/telegram.json']);
    });
  });

  it('fences a declared file that contains a fence of its own', async () => {
    await withTempDir(async (dir) => {
      // A Markdown file with a code block in it would otherwise close the section early,
      // and the platform would read the rest of the file as prose.
      project(dir, {
        'agent.yaml': MANIFEST,
        'files/home/notes/HOWTO.md': 'Run it:\n\n```\nls\n```\n',
      });

      const { source } = compileProject(dir);
      expect(source).toContain('````\nRun it:\n\n```\nls\n```\n````');
    });
  });

  it('refuses a directory that is not a project, and says how to make one', async () => {
    await withTempDir(async (dir) => {
      expect(() => compileProject(dir)).toThrow(/No agent\.yaml/);
      try {
        compileProject(dir);
        expect.unreachable();
      } catch (err) {
        expect((err as CliError).hint).toContain('agent init');
      }
    });
  });
});

describe('the environment file', () => {
  it('becomes YAML pairs, quoted on both sides', () => {
    // The key is templated as often as the value is: `{{llmKeyVar}}` resolves to
    // whatever name the chosen provider reads, and unquoted braces are not YAML.
    expect(envToYaml('{{llmKeyVar}}={{llmApiKey}}')).toBe("'{{llmKeyVar}}': '{{llmApiKey}}'");
    expect(envToYaml('LLM_PROVIDER={{llmProvider | "openrouter"}}')).toBe(
      `'LLM_PROVIDER': '{{llmProvider | "openrouter"}}'`,
    );
  });

  it('keeps a value that itself contains an equals sign whole', () => {
    expect(envToYaml('DSN=postgres://u:p@h/db?sslmode=require')).toBe(
      "'DSN': 'postgres://u:p@h/db?sslmode=require'",
    );
  });

  it('escapes a quote the YAML way rather than dropping it', () => {
    expect(envToYaml("GREETING=it's here")).toBe("'GREETING': 'it''s here'");
  });

  it('passes comments and blank lines through, because they explain the keys', () => {
    expect(envToYaml('# which key\n\nA=b')).toBe("# which key\n\n'A': 'b'");
  });

  it('refuses a line that is not KEY=value', () => {
    expect(() => envToYaml('just a sentence')).toThrow(/not KEY=value/);
  });
});

describe('choosing what to act on', () => {
  it('prefers the project when a directory has both shapes', async () => {
    await withTempDir(async (dir) => {
      project(dir, {
        'agent.yaml': MANIFEST,
        'soul.md': 'from the project\n',
        'agent.md': '---\nid: stale\n---\n\n## Soul\n\nfrom the document\n',
      });

      const loaded = loadSource(dir);
      expect(loaded.kind).toBe('project');
      expect(loaded.source).toContain('from the project');
    });
  });

  it('still reads a lone document, which is what an example ships as', async () => {
    await withTempDir(async (dir) => {
      project(dir, { 'agent.md': '---\nid: example\n---\n\n## Soul\n\nhello\n' });

      const loaded = loadSource(dir);
      expect(loaded.kind).toBe('document');
      expect(loaded.inputs).toEqual([]);
    });
  });

  it('names both shapes when a directory has neither', async () => {
    await withTempDir(async (dir) => {
      expect(() => loadSource(dir)).toThrow(/No agent\.yaml or agent\.md/);
    });
  });
});
