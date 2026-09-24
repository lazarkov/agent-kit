import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import type { Context } from '../context.js';
import { jsonOut } from '../output.js';
import type { BlueprintExample } from '../types.js';

/**
 * What `init --template` can start from.
 *
 * The platform's examples are ordered on purpose — each adds one part of the format
 * to the one before it — so they are printed in the order they arrive rather than
 * sorted.
 */
export async function templates(ctx: Context, _args: ParsedArgs): Promise<void> {
  const examples = unwrap<BlueprintExample[]>(
    await ctx.api.get('/agents/blueprints/examples'),
  );

  if (ctx.json) {
    // Without the source: this is a list, and four whole documents would bury it.
    jsonOut(
      ctx.io,
      examples.map(({ slug, name, description, sections }) => ({
        slug,
        name,
        description,
        sections,
      })),
    );
    return;
  }

  for (const example of examples) {
    ctx.io.out(`${ctx.style.bold(example.slug)}  ${ctx.style.dim(example.name)}`);
    ctx.io.out(`  ${example.description}`);
    if (example.sections && example.sections.length > 0) {
      ctx.io.out(`  ${ctx.style.dim(`sections: ${example.sections.join(', ')}`)}`);
    }
    ctx.io.out('');
  }

  const first = examples[0]?.slug ?? 'starter';
  ctx.io.out(
    `Start one with ${ctx.style.cyan(`agent init --template ${first} my-project`)}`,
  );
}
