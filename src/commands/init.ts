import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative, sep } from 'node:path';

import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { boolFlag, stringFlag } from '../args.js';
import type { Context } from '../context.js';
import { DEFAULT_DOCUMENT } from '../document.js';
import { CliError } from '../errors.js';
import { readScalar, rewriteFrontmatter, rewriteScalars } from '../frontmatter.js';
import { jsonOut } from '../output.js';
import { projectTemplateDir, resolveTarget, toBlueprintId, toDisplayName } from '../paths.js';
import { MANIFEST } from '../project.js';
import type { BlueprintExample } from '../types.js';

const GITIGNORE_LINES = ['.env.local', '.agentspaces/'];

/**
 * A template file whose name cannot be its destination.
 *
 * `.env` is in this package's own `.gitignore`, and npm falls back to that when
 * deciding what goes in the tarball, so a template called `.env` would be missing
 * from every install. It ships as `env` and lands as `.env`.
 */
const RENAMED: Record<string, string> = { env: '.env' };

/**
 * Scaffolds a project.
 *
 * With no flags this touches the network not at all: the scaffold ships inside the
 * package, so `agent init` works on a plane and in a CI image with no egress.
 * `--template <slug>` fetches one of the platform's examples instead, which is a read
 * anyone may make, still with no login.
 */
export async function init(ctx: Context, args: ParsedArgs): Promise<void> {
  const dir = resolveTarget(ctx.cwd, args.positionals[0]);
  const slug = stringFlag(args, 'template');
  const force = boolFlag(args, 'force');

  // The directory names the agent. Its id is what the platform upserts on, and two
  // projects scaffolded from one template would otherwise both claim the same one,
  // the second quietly replacing the first.
  const id = toBlueprintId(basename(dir));
  const name = toDisplayName(id);

  for (const existing of [MANIFEST, DEFAULT_DOCUMENT]) {
    const path = join(dir, existing);
    if (existsSync(path) && !force) {
      throw new CliError(`${relative(ctx.cwd, path) || existing} already exists.`, {
        hint: 'Pass --force to overwrite it, or init into another directory.',
      });
    }
  }

  const written =
    slug === null
      ? scaffold(dir, { id, name })
      : [writeDocument(dir, await fetchExample(ctx, slug), { id, name })];

  const wroteGitignore = ensureGitignore(dir);
  const manifest = existsSync(join(dir, MANIFEST))
    ? readFileSync(join(dir, MANIFEST), 'utf8')
    : '';
  const origin = slug === null ? 'starter project' : `template ${slug}`;

  if (ctx.json) {
    jsonOut(ctx.io, {
      path: dir,
      id,
      template: origin,
      files: written,
      gitignore: wroteGitignore,
    });
    return;
  }

  const here = relative(ctx.cwd, dir) || '.';
  ctx.io.out(`${ctx.style.green('created')} ${here}  ${ctx.style.dim(`(${origin})`)}`);
  ctx.io.out('');
  for (const file of written) ctx.io.out(`  ${file}`);
  if (wroteGitignore) ctx.io.out('  .gitignore');
  ctx.io.out('');
  ctx.io.out(`  id    ${id}`);
  ctx.io.out(`  name  ${readScalar(manifest, 'name') ?? name}`);
  ctx.io.out('');
  ctx.io.out('Next:');
  if (slug === null) {
    ctx.io.out(
      `  ${ctx.style.bold('1.')} Edit ${ctx.style.cyan('agent.yaml')}: the description is the line people read on the card.`,
    );
    ctx.io.out(
      `  ${ctx.style.bold('2.')} Write ${ctx.style.cyan('soul.md')}. It is the agent's instructions, and the only part that must be yours.`,
    );
    ctx.io.out(
      `  ${ctx.style.bold('3.')} ${ctx.style.cyan('agent validate')}: the platform reads the project back and says what it would build.`,
    );
    ctx.io.out('');
    ctx.io.out(
      ctx.style.dim(
        'Optional, and picked up the moment they exist: setup.sh, schedule.yaml, test.yaml, diagnostics.yaml.',
      ),
    );
  } else {
    ctx.io.out(
      `  ${ctx.style.bold('1.')} Read it: an example ships as one document rather than as a project.`,
    );
    ctx.io.out(
      `  ${ctx.style.bold('2.')} ${ctx.style.cyan('agent validate')} works on either shape.`,
    );
  }
}

/** Copies the scaffold, naming the agent after its directory. Returns what it wrote. */
function scaffold(dir: string, names: { id: string; name: string }): string[] {
  const root = projectTemplateDir();
  if (!existsSync(root)) {
    throw new CliError('The starter project is missing from this installation.', {
      hint: 'Reinstall the package, or pass --template to fetch an example from the platform.',
    });
  }

  const written: string[] = [];
  for (const source of walk(root)) {
    const parts = source.split(posix.sep);
    const last = parts[parts.length - 1]!;
    parts[parts.length - 1] = RENAMED[last] ?? last;
    const destination = parts.join(posix.sep);

    let contents = readFileSync(join(root, ...source.split(posix.sep)), 'utf8');
    if (destination === MANIFEST) contents = `${rewriteScalars(contents.trimEnd(), names)}\n`;

    const path = join(dir, ...destination.split(posix.sep));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
    written.push(destination);
  }
  return written.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

/** Relative paths of every file under `root`, with forward slashes. */
function walk(root: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const next = prefix === '' ? entry.name : `${prefix}${sep}${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(root, next));
    else found.push(next.split(sep).join(posix.sep));
  }
  return found;
}

function depth(path: string): number {
  return path.split(posix.sep).length;
}

/**
 * The one case that stays a document: a platform example.
 *
 * Turning one back into a project would need a blueprint parser, which this package
 * deliberately does not have. The examples are written to be read, and every command
 * here accepts a document as readily as a project.
 */
function writeDocument(dir: string, source: string, names: { id: string; name: string }): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, DEFAULT_DOCUMENT), rewriteFrontmatter(source, names), 'utf8');
  return DEFAULT_DOCUMENT;
}

async function fetchExample(ctx: Context, slug: string): Promise<string> {
  const examples = unwrap<BlueprintExample[]>(await ctx.api.get('/agents/blueprints/examples'));
  const match = examples.find((example) => example.slug === slug || example.name === slug);
  if (!match) {
    throw new CliError(`No template called '${slug}'.`, {
      hint: `Available: ${examples.map((example) => example.slug).join(', ')}`,
    });
  }
  return match.source;
}

/**
 * Local values and the build output are not part of the agent, so a project that is
 * going to be a repository gets told so on day one. `.env` itself is committed: it
 * holds the names the container reads, and the placeholders those are filled from.
 */
function ensureGitignore(dir: string): boolean {
  const path = join(dir, '.gitignore');
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8');
    const missing = GITIGNORE_LINES.filter((line) => !existing.split(/\r?\n/).includes(line));
    if (missing.length === 0) return false;
    const separator = existing.endsWith('\n') ? '' : '\n';
    writeFileSync(path, `${existing}${separator}${missing.join('\n')}\n`, 'utf8');
    return true;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${GITIGNORE_LINES.join('\n')}\n`, 'utf8');
  return true;
}
