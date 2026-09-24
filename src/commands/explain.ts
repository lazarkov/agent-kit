import { relative } from 'node:path';

import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { stringFlag } from '../args.js';
import type { Context } from '../context.js';
import { loadDocument } from '../document.js';
import { jsonOut } from '../output.js';
import type { BlueprintPreview } from '../types.js';

/**
 * The long form of `validate`: the same preview, read out as what will happen.
 *
 * It exists because the document is the whole product. A person editing one wants
 * to know what the wizard will ask, which variables reach the container, what the
 * agent is allowed to touch and what it will be told it is — before paying for a
 * server to find out.
 */
export async function explain(ctx: Context, args: ParsedArgs): Promise<void> {
  const target = args.positionals[0] ?? stringFlag(args, 'file');
  const document = loadDocument(ctx.cwd, target);

  const preview = unwrap<BlueprintPreview>(
    await ctx.api.post('/agents/blueprints/validate', { source: document.source }),
  );

  if (ctx.json) {
    jsonOut(ctx.io, preview);
    return;
  }

  const { style, io } = ctx;
  io.out(`${style.bold(preview.name)} ${style.dim(`(${preview.id})`)}`);
  io.out(preview.description);
  io.out(style.dim(relative(ctx.cwd, document.path) || document.path));
  io.out('');

  const brain = preview.brain ?? 'hermes';
  const model = preview.runtime?.['defaultModel'];
  io.out(section(style, 'Where it runs'));
  io.out(`  A ${brain} container, one per agent, on a server of its own.`);
  if (model) io.out(`  Its model is ${style.cyan(String(model))} unless whoever deploys it picks another.`);
  io.out('');

  const steps = preview.steps ?? [];
  if (steps.length > 0) {
    io.out(section(style, 'What it asks for before it starts'));
    for (const [index, step] of steps.entries()) {
      const label = step.label ?? step.id;
      io.out(`  ${index + 1}. ${label} ${style.dim(`— ${step.description ?? step.panel}`)}`);
    }
    io.out('');
  }

  const config = preview.config ?? [];
  if (config.length > 0) {
    io.out(section(style, 'What it will be given'));
    for (const field of config) {
      const marks = [
        field.required ? 'required' : 'optional',
        field.sensitive ? style.yellow('secret') : null,
        field.type,
      ].filter(Boolean);
      io.out(`  ${field.key} ${style.dim(`(${marks.join(', ')})`)}`);
      if (field.help) io.out(`    ${style.dim(field.help)}`);
    }
    io.out('');
  }

  const envKeys = preview.envKeys ?? [];
  if (envKeys.length > 0) {
    io.out(section(style, 'What reaches the container as environment'));
    io.out(`  ${envKeys.join(', ')}`);
    // Names with braces are resolved per-deploy, and reading that as a literal
    // variable name is the mistake this line exists to prevent.
    if (envKeys.some((key) => key.includes('{{'))) {
      io.out(style.dim('  A templated name resolves when the agent is created — the key lands under whatever the chosen provider reads.'));
    }
    io.out('');
  }

  const toolsets = preview.toolsets ?? [];
  if (toolsets.length > 0) {
    const enabled = toolsets.filter((toolset) => toolset.enabled);
    const withheld = toolsets.filter((toolset) => !toolset.enabled);
    io.out(section(style, 'What it is allowed to do'));
    for (const toolset of enabled) {
      io.out(`  ${style.green('✓')} ${toolset.label ?? toolset.key} ${style.dim(toolset.tools ? `— ${toolset.tools}` : '')}`);
    }
    for (const toolset of withheld) {
      io.out(`  ${style.dim('·')} ${style.dim(`${toolset.label ?? toolset.key} — withheld`)}`);
    }
    io.out('');
  }

  const files = preview.files ?? [];
  const setup = preview.setup ?? [];
  if (files.length > 0 || setup.length > 0) {
    io.out(section(style, 'What is put in place first'));
    for (const file of files) io.out(`  file  ${file}`);
    for (const command of setup) io.out(`  run   ${command}`);
    io.out('');
  }

  const schedule = preview.schedule ?? [];
  if (schedule.length > 0) {
    io.out(section(style, 'What it does on its own'));
    for (const job of schedule) {
      // `deliver` defaults to telegram on the platform, not to the caller — an agent
      // whose nightly report goes somewhere the author did not expect is the failure
      // this line is here to prevent.
      const how = job.noAgent
        ? `runs ${job.script ?? 'a script'}, no model involved`
        : (job.script ?? 'prompts the model');
      io.out(`  ${job.name ?? 'job'} ${style.dim(`every ${job.every ?? '?'} → ${job.deliver ?? 'telegram'}`)}`);
      io.out(`    ${style.dim(how)}`);
    }
    io.out('');
  }

  const soul = preview.soul ?? '';
  if (soul) {
    io.out(section(style, `What it is told it is (${preview.soulLines ?? 0} lines)`));
    for (const line of soul.split('\n').slice(0, 12)) io.out(`  ${style.dim(line)}`);
    if ((preview.soulLines ?? 0) > 12) io.out(style.dim('  …'));
    io.out('');
  }

  if (schedule.length === 0) {
    io.out(style.dim('No schedule: this agent acts when it is spoken to.'));
  }
}

function section(style: Context['style'], title: string): string {
  return style.bold(title);
}
