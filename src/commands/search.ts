import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { boolFlag, stringFlag } from '../args.js';
import type { Context } from '../context.js';
import { jsonOut } from '../output.js';
import type { AgentType } from '../types.js';

const PAGE = 20;

/**
 * The published catalogue, searched from the terminal.
 *
 * Filtering happens here rather than in a query parameter because the route answers
 * the whole list in one response and has no search of its own. That is fine at this
 * size, and it means `--verified` and `--brain` compose without the API needing to
 * have anticipated the combination.
 */
export async function search(ctx: Context, args: ParsedArgs): Promise<void> {
  const query = args.positionals.join(' ').trim().toLowerCase();
  const category = stringFlag(args, 'category');
  const brain = stringFlag(args, 'brain');
  const verifiedOnly = boolFlag(args, 'verified');
  const all = boolFlag(args, 'all');

  const catalogue = unwrap<AgentType[]>(await ctx.api.get('/agents/types'));

  const matches = catalogue.filter((type) => {
    if (verifiedOnly && !type.verified) return false;
    if (category && type.category !== category) return false;
    if (brain && type.brain !== brain) return false;
    if (query.length === 0) return true;
    const haystack = [type.id, type.name, type.description, ...(type.tags ?? [])]
      .join(' ')
      .toLowerCase();
    return query.split(/\s+/).every((term) => haystack.includes(term));
  });

  if (ctx.json) {
    jsonOut(ctx.io, matches);
    return;
  }

  if (matches.length === 0) {
    ctx.io.out('Nothing matched.');
    ctx.io.out(ctx.style.dim(`${catalogue.length} agents in the catalogue.`));
    return;
  }

  // Verified first: it means somebody ran the thing, which is the only signal here
  // that separates a card from a working agent.
  const ordered = [...matches].sort((a, b) => Number(b.verified) - Number(a.verified));
  const shown = all ? ordered : ordered.slice(0, PAGE);

  for (const type of shown) {
    const marks = [
      type.verified ? ctx.style.green('verified') : null,
      type.brain && type.brain !== 'hermes' ? ctx.style.cyan(type.brain) : null,
      type.hasTest ? ctx.style.dim('has test') : null,
    ].filter(Boolean);
    ctx.io.out(`${ctx.style.bold(type.id)}  ${type.name} ${marks.join(' ')}`);
    ctx.io.out(`  ${ctx.style.dim(truncate(type.description, 100))}`);
  }

  ctx.io.out('');
  const tail = shown.length < ordered.length ? ` (showing ${shown.length}, pass --all for the rest)` : '';
  ctx.io.out(ctx.style.dim(`${ordered.length} of ${catalogue.length} agents${tail}.`));
}

function truncate(text: string, limit: number): string {
  const single = (text ?? '').replace(/\s+/g, ' ').trim();
  return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
}
