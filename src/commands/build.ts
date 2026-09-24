import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { ParsedArgs } from '../args.js';
import { boolFlag, stringFlag } from '../args.js';
import type { Context } from '../context.js';
import { jsonOut } from '../output.js';
import { BUILD_DIR, BUILD_FILE, loadSource } from '../project.js';

/**
 * Turns the project into the one document the platform's API takes.
 *
 * Nobody has to run this: `validate`, `explain` and a deploy all build in memory
 * first. It exists for the two moments when the intermediate form matters, which are
 * reading it to understand what the API was sent, and having it on disk so a CI job
 * can post it without this package installed.
 *
 * The output goes under `.agentspaces/`, which init gitignores, because it is a build
 * artefact: editing it would be editing the thing that gets overwritten.
 */
export async function build(ctx: Context, args: ParsedArgs): Promise<void> {
  const target = args.positionals[0] ?? stringFlag(args, 'file');
  const agent = loadSource(ctx.cwd, target);

  // `--emit` is for a pipe, so nothing else may go to stdout.
  if (boolFlag(args, 'emit')) {
    ctx.io.out(agent.source.trimEnd());
    return;
  }

  const root = agent.kind === 'project' ? agent.path : ctx.cwd;
  const out = join(root, BUILD_DIR, BUILD_FILE);
  mkdirSync(join(root, BUILD_DIR), { recursive: true });
  writeFileSync(out, agent.source, 'utf8');

  const lines = agent.source.split('\n').length;
  const bytes = Buffer.byteLength(agent.source, 'utf8');

  if (ctx.json) {
    jsonOut(ctx.io, {
      path: out,
      from: agent.path,
      kind: agent.kind,
      bytes,
      inputs: agent.inputs,
    });
    return;
  }

  const shown = relative(ctx.cwd, out) || out;
  ctx.io.out(`${ctx.style.green('built')}  ${shown}  ${ctx.style.dim(`${lines} lines, ${bytes} bytes`)}`);
  if (agent.inputs.length > 0) {
    ctx.io.out('');
    for (const input of agent.inputs) ctx.io.out(`  ${ctx.style.dim(input)}`);
  }
  ctx.io.out('');
  ctx.io.out(
    ctx.style.dim(`Run 'agent validate' to have the platform read it, or 'agent build --emit' to print it.`),
  );
}
