import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { boolFlag, stringFlag } from '../args.js';
import type { Context } from '../context.js';
import { DEFAULT_DOCUMENT } from '../document.js';
import { CliError } from '../errors.js';
import { readFrontmatterValue, rewriteFrontmatter } from '../frontmatter.js';
import { jsonOut } from '../output.js';
import { resolveTarget, templatePath, toBlueprintId, toDisplayName } from '../paths.js';
import type { BlueprintExample } from '../types.js';

const GITIGNORE_LINES = ['.env', '.env.local', '.agentspaces/'];

/**
 * Starts a document.
 *
 * With no flags this touches the network not at all: the starter template ships
 * inside the package, so `agent init` works on a plane and in a CI image with no
 * egress. `--template <slug>` fetches one of the platform's examples instead, which
 * is a read anyone may make — still no login.
 */
export async function init(ctx: Context, args: ParsedArgs): Promise<void> {
  const dir = resolveTarget(ctx.cwd, args.positionals[0]);
  const slug = stringFlag(args, 'template');
  const force = boolFlag(args, 'force');

  const documentPath = join(dir, DEFAULT_DOCUMENT);
  if (existsSync(documentPath) && !force) {
    throw new CliError(`${relative(ctx.cwd, documentPath) || DEFAULT_DOCUMENT} already exists.`, {
      hint: 'Pass --force to overwrite it, or init into another directory.',
    });
  }

  const template = slug === null ? readVendored() : await fetchExample(ctx, slug);

  // The directory names the agent. A document carries its own id, that id is what
  // the platform upserts on, and two projects scaffolded from one template would
  // otherwise both claim it — the second overwriting the first.
  const id = toBlueprintId(basename(dir));
  const source = rewriteFrontmatter(template.source, { id, name: toDisplayName(id) });

  mkdirSync(dir, { recursive: true });
  writeFileSync(documentPath, source, 'utf8');
  const wroteGitignore = ensureGitignore(dir);

  if (ctx.json) {
    jsonOut(ctx.io, {
      path: documentPath,
      id,
      template: template.origin,
      gitignore: wroteGitignore,
    });
    return;
  }

  const shown = relative(ctx.cwd, documentPath) || DEFAULT_DOCUMENT;
  ctx.io.out(`${ctx.style.green('created')} ${shown}  ${ctx.style.dim(`(${template.origin})`)}`);
  if (wroteGitignore) {
    ctx.io.out(`${ctx.style.green('created')} ${relative(ctx.cwd, join(dir, '.gitignore')) || '.gitignore'}`);
  }
  ctx.io.out('');
  ctx.io.out(`  id    ${id}`);
  ctx.io.out(`  name  ${readFrontmatterValue(source, 'name') ?? toDisplayName(id)}`);
  ctx.io.out('');
  ctx.io.out('Next:');
  ctx.io.out(`  ${ctx.style.bold('1.')} Edit the description — it is the line people read on the card.`);
  ctx.io.out(`  ${ctx.style.bold('2.')} Write the ${ctx.style.cyan('## Soul')} section. It is the agent's instructions, and the only part that must be yours.`);
  ctx.io.out(`  ${ctx.style.bold('3.')} ${ctx.style.cyan('agent validate')} — the platform reads it back and says what it would build.`);
}

interface Template {
  source: string;
  /** Where it came from, for the one line init prints. */
  origin: string;
}

function readVendored(): Template {
  const path = templatePath('starter');
  try {
    return { source: readFileSync(path, 'utf8'), origin: 'starter template' };
  } catch {
    throw new CliError('The starter template is missing from this installation.', {
      hint: 'Reinstall the package, or pass --template to fetch one from the platform.',
    });
  }
}

async function fetchExample(ctx: Context, slug: string): Promise<Template> {
  const examples = unwrap<BlueprintExample[]>(
    await ctx.api.get('/agents/blueprints/examples'),
  );
  const match = examples.find((example) => example.slug === slug || example.name === slug);
  if (!match) {
    throw new CliError(`No template called '${slug}'.`, {
      hint: `Available: ${examples.map((example) => example.slug).join(', ')}`,
    });
  }
  return { source: match.source, origin: `template ${match.slug}` };
}

/**
 * Agent documents sit next to the values they are configured with, and a deploy
 * writes a local state directory. Neither belongs in a commit, so a project that is
 * going to be a repository gets told so on day one.
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
