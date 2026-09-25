import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import { guardSource, DEFAULT_DOCUMENT, loadDocument } from './document.js';
import { CliError, UsageError } from './errors.js';

/**
 * An agent is a directory, not a file.
 *
 * The platform's API takes one document, and that is a fact about the wire rather
 * than about how anyone wants to work: a real agent is a prompt, a runtime config,
 * an environment, a setup script and whatever files it needs on the box, and those
 * are separate concerns that want separate files. So this is the source of truth,
 * and the document is a build artefact nobody edits.
 *
 * Every file here maps to exactly one section, and the mapping is the whole format:
 * no file is parsed, only read and framed. That keeps this package free of a YAML
 * parser and free of a second opinion about the blueprint format, which the backend
 * owns and validates.
 */

/** The file whose presence makes a directory a project. Becomes the frontmatter. */
export const MANIFEST = 'agent.yaml';

/** The compiled document, written where a deploy can find it and a commit cannot. */
export const BUILD_DIR = '.agentspaces';
export const BUILD_FILE = 'agent.md';

/** Files under `files/` whose name ends in this hold a `when:` condition, not content. */
const WHEN_SUFFIX = '.when';

/** The directory whose contents become `## Files`. */
const FILES_DIR = 'files';

/**
 * `files/home/notes/README.md` is `{{home}}/notes/README.md` in the container, and
 * anything else is absolute: `files/opt/data/x` is `/opt/data/x`. Reserving one
 * top-level name is what lets a project name the agent's own directory without
 * hardcoding a runtime's layout, which differs between Hermes and OpenClaw.
 */
const HOME_DIR = 'home';

interface SectionFile {
  /** Path relative to the project root. */
  file: string;
  /** The `## Heading` it becomes. */
  section: string;
  /** How the body is framed in the document. */
  as: 'yaml' | 'sh' | 'raw';
}

/**
 * In document order, which is the order the platform's own examples teach in. A
 * missing file is a missing section, which for every one of these is legal.
 */
const SECTIONS: readonly SectionFile[] = [
  { file: 'fields.yaml', section: 'Config', as: 'yaml' },
  { file: 'onboarding.yaml', section: 'Onboarding', as: 'yaml' },
  { file: '.env', section: 'Environment', as: 'yaml' },
  { file: 'config.yaml', section: 'Runtime', as: 'yaml' },
  { file: 'schedule.yaml', section: 'Schedule', as: 'yaml' },
  { file: 'setup.sh', section: 'Setup', as: 'sh' },
  { file: 'test.yaml', section: 'Test', as: 'yaml' },
  { file: 'diagnostics.yaml', section: 'Diagnostics', as: 'yaml' },
  { file: 'soul.md', section: 'Soul', as: 'raw' },
];

/** Every path a scaffolded project uses, for help text and for the README. */
export const PROJECT_FILES: readonly string[] = [
  MANIFEST,
  ...SECTIONS.map((section) => section.file),
  `${FILES_DIR}/`,
];

export interface CompiledProject {
  /** The document, exactly as it would be sent. */
  source: string;
  /** The project's own files that went into it, relative and in document order. */
  inputs: string[];
}

export function isProject(dir: string): boolean {
  return existsSync(join(dir, MANIFEST));
}

/**
 * Assembles the document from the directory.
 *
 * Reads and frames, in order. The only content this touches is `.env`, because
 * `KEY=value` is not YAML and the Environment section is; everything else arrives
 * in the document byte for byte, so a mistake in it is reported by the platform
 * against text the author actually wrote.
 */
export function compileProject(dir: string): CompiledProject {
  const manifestPath = join(dir, MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new UsageError(
      `No ${MANIFEST} in ${dir}.`,
      `Run 'agent init' to scaffold a project here.`,
    );
  }

  const frontmatter = readFileSync(manifestPath, 'utf8').trim();
  if (frontmatter.length === 0) {
    throw new CliError(`${MANIFEST} is empty.`, {
      hint: 'It holds the agent’s id, name, description, category and tags.',
    });
  }

  const inputs: string[] = [MANIFEST];
  const parts: string[] = ['---', frontmatter, '---', ''];

  for (const section of SECTIONS) {
    const path = join(dir, section.file);
    if (!existsSync(path)) continue;
    const body = readFileSync(path, 'utf8').trim();
    if (body.length === 0) continue;

    inputs.push(section.file);
    parts.push(`## ${section.section}`, '');
    if (section.as === 'raw') {
      parts.push(body, '');
    } else {
      const content = section.file === '.env' ? envToYaml(body) : body;
      parts.push(...fence(content, section.as === 'sh' ? 'sh' : 'yaml'), '');
    }
  }

  // `## Files` last but one, because it is the long section and the soul above it is
  // the one a reader opens the document for. Order is otherwise the platform's.
  const declared = readFilesDir(dir);
  if (declared.length > 0) {
    const filesSection: string[] = ['## Files', ''];
    for (const file of declared) {
      inputs.push(`${FILES_DIR}/${file.relative}`);
      filesSection.push(`### ${file.containerPath}`);
      if (file.when) filesSection.push(`when: ${file.when}`);
      filesSection.push('', ...fence(file.contents, languageOf(file.relative)), '');
    }
    // Soul is written last in the document, so splice Files in before it.
    const soulAt = parts.indexOf('## Soul');
    if (soulAt === -1) parts.push(...filesSection);
    else parts.splice(soulAt, 0, ...filesSection);
  }

  const source = `${parts.join('\n').trimEnd()}\n`;
  // Labelled as the project rather than as a file: the size is the sum of every
  // fragment, so no one file is the thing to go and shorten.
  guardSource(source, 'This project');
  return { source, inputs };
}

export interface LoadedSource {
  /** What the platform will be sent. */
  source: string;
  /** What to show a reader: the project directory, or the document's path. */
  path: string;
  kind: 'project' | 'document';
  /** The files it was built from, in document order. Empty for a document. */
  inputs: string[];
}

/**
 * What a command acts on: a project if there is one, otherwise a document.
 *
 * Both shapes stay supported on purpose. The platform's examples are documents,
 * `agent init --template` writes one, and a document pasted from a share link has to
 * validate without being taken apart first.
 */
export function loadSource(cwd: string, target?: string | null): LoadedSource {
  const candidate = target ? join(cwd, target) : cwd;
  const isDir = existsSync(candidate) && statSync(candidate).isDirectory();

  if (isDir && isProject(candidate)) {
    return { ...compileProject(candidate), path: candidate, kind: 'project' };
  }

  if (!target && !existsSync(join(cwd, DEFAULT_DOCUMENT))) {
    throw new UsageError(
      `No ${MANIFEST} or ${DEFAULT_DOCUMENT} in this directory.`,
      `Run 'agent init' to scaffold a project, or name one: agent validate path/to/project`,
    );
  }

  const document = loadDocument(cwd, target);
  return { source: document.source, path: document.path, kind: 'document', inputs: [] };
}

export interface DeclaredFile {
  /** Path under `files/`, with forward slashes. */
  relative: string;
  /** The path it lands on in the container. */
  containerPath: string;
  contents: string;
  when: string | null;
}

/**
 * The files under `files/`, as the document would declare them.
 *
 * Exported because a local run has to place the same files in the same places, and
 * reading the directory a second time somewhere else is how the two would disagree
 * about what `files/home/` means.
 */
export function declaredFiles(dir: string): DeclaredFile[] {
  return readFilesDir(dir);
}

function readFilesDir(dir: string): DeclaredFile[] {
  const root = join(dir, FILES_DIR);
  if (!existsSync(root)) return [];

  const found: DeclaredFile[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.name.endsWith(WHEN_SUFFIX)) continue;
      const rel = relative(root, path).split(sep).join(posix.sep);
      const whenPath = `${path}${WHEN_SUFFIX}`;
      found.push({
        relative: rel,
        containerPath: toContainerPath(rel),
        contents: readFileSync(path, 'utf8').replace(/\s+$/, ''),
        when: existsSync(whenPath) ? readFileSync(whenPath, 'utf8').trim() : null,
      });
    }
  };
  walk(root);
  return found;
}

function toContainerPath(relativePath: string): string {
  const [first, ...rest] = relativePath.split(posix.sep);
  if (first === HOME_DIR) return ['{{home}}', ...rest].join(posix.sep);
  return `/${relativePath}`;
}

/**
 * `KEY=value` lines become `'KEY': 'value'`.
 *
 * Both sides are quoted always, rather than only where a value needs it: a key can
 * itself be templated (`{{llmKeyVar}}`, which resolves to whatever the chosen
 * provider reads) and a value routinely holds `{{a | "b"}}`, so a rule with
 * exceptions in it would be the thing that breaks. Comments and blank lines pass
 * through, because an author's note about which key is which is worth keeping.
 */
export function envToYaml(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) return trimmed;
      const at = trimmed.indexOf('=');
      if (at === -1) {
        throw new CliError(`.env line is not KEY=value: ${trimmed}`, {
          hint: 'Environment entries are one KEY=value per line; comments start with #.',
        });
      }
      const key = trimmed.slice(0, at).trim();
      const value = trimmed.slice(at + 1).trim();
      return `${quote(key)}: ${quote(value)}`;
    })
    .join('\n');
}

/** YAML single quotes, where the only escape is a doubled quote. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * A fence long enough to hold the content.
 *
 * A declared file can itself be a Markdown document with a code block in it, and a
 * three-backtick fence around three backticks ends the section early: the platform
 * would then read the rest of the file as prose and the author would see a section
 * it never occurred to them to check.
 */
function fence(content: string, language: string): string[] {
  const longest = [...content.matchAll(/^\s*(`{3,})/gm)].reduce(
    (max, match) => Math.max(max, (match[1] ?? '').length),
    2,
  );
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return [`${ticks}${language}`, content, ticks];
}

function languageOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const known: Record<string, string> = {
    sh: 'sh',
    bash: 'sh',
    py: 'python',
    js: 'javascript',
    ts: 'typescript',
    json: 'json',
    toml: 'toml',
    yaml: 'yaml',
    yml: 'yaml',
    md: '',
    txt: '',
  };
  return known[extension] ?? '';
}
