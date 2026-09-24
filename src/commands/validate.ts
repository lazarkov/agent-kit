import { relative } from 'node:path';

import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { stringFlag } from '../args.js';
import type { Context } from '../context.js';
import { jsonOut, table } from '../output.js';
import { loadSource } from '../project.js';
import type { BlueprintPreview } from '../types.js';

/**
 * Builds the project and asks the platform what it would make of it.
 *
 * There is no blueprint parser in this package on purpose. The format belongs to the
 * backend, which validates section by section and answers with the section it
 * objected to and the likely fix; a copy of those rules living out here would be
 * wrong within a release, and wrong in the direction of passing agents the platform
 * will then refuse.
 */
export async function validate(ctx: Context, args: ParsedArgs): Promise<void> {
  const target = args.positionals[0] ?? stringFlag(args, 'file');
  const agent = loadSource(ctx.cwd, target);

  const preview = unwrap<BlueprintPreview>(
    await ctx.api.post('/agents/blueprints/validate', { source: agent.source }),
  );

  if (ctx.json) {
    jsonOut(ctx.io, preview);
    return;
  }

  const shown = relative(ctx.cwd, agent.path) || agent.path;
  ctx.io.out(`${ctx.style.green('valid')}  ${shown}`);
  ctx.io.out('');

  const rows: [string, string][] = [
    ['id', preview.id],
    ['name', preview.name],
    ['runtime', preview.brain ?? '-'],
    ['model', String(preview.runtime?.['defaultModel'] ?? '-')],
    ['wizard', `${preview.steps?.length ?? 0} step(s)`],
    ['config', `${preview.config?.length ?? 0} field(s)`],
    ['soul', `${preview.soulLines ?? 0} line(s)`],
  ];

  const toolsets = (preview.toolsets ?? []).filter((toolset) => toolset.enabled);
  if (toolsets.length > 0) {
    rows.push(['toolsets', toolsets.map((toolset) => toolset.key).join(', ')]);
  }
  if (preview.envKeys && preview.envKeys.length > 0) {
    rows.push(['env', preview.envKeys.join(', ')]);
  }
  if (preview.files && preview.files.length > 0) {
    rows.push(['files', preview.files.join(', ')]);
  }
  if (preview.setup && preview.setup.length > 0) {
    rows.push(['setup', `${preview.setup.length} command(s)`]);
  }
  if (preview.schedule && preview.schedule.length > 0) {
    rows.push([
      'schedule',
      preview.schedule.map((job) => job.name ?? job.every ?? '?').join(', '),
    ]);
  }
  if (preview.diagnostics && preview.diagnostics.length > 0) {
    rows.push(['diagnostics', `${preview.diagnostics.length} check(s)`]);
  }

  for (const line of table(rows)) ctx.io.out(`  ${line}`);

  ctx.io.out('');
  ctx.io.out(ctx.style.dim(`Run 'agent explain' for what each of those means for this agent.`));
}
