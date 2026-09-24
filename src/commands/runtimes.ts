import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import type { Context } from '../context.js';
import { jsonOut } from '../output.js';
import type { RuntimeInfo } from '../types.js';

/**
 * Which container a `brain:` resolves to, and which release of it was checked.
 *
 * This is the whole premise of the tool in one list: the same document deploys onto
 * any brain here, so a person choosing one wants to see what they are choosing
 * between: the pinned image, when it was last verified against upstream, and
 * whether upstream has moved since.
 */
export async function runtimes(ctx: Context, _args: ParsedArgs): Promise<void> {
  const list = unwrap<RuntimeInfo[]>(await ctx.api.get('/agents/runtimes'));

  if (ctx.json) {
    jsonOut(ctx.io, list);
    return;
  }

  for (const runtime of list) {
    const pinned = runtime.verified?.[runtime.verified.length - 1];
    ctx.io.out(`${ctx.style.bold(runtime.brain)}  ${ctx.style.dim(runtime.repo ?? runtime.image)}`);
    ctx.io.out(`  image     ${pinned?.image ?? runtime.image}`);
    if (pinned?.checkedAt) {
      ctx.io.out(`  verified  ${pinned.release ?? '?'} ${ctx.style.dim(`checked ${pinned.checkedAt}`)}`);
    }

    const upstream = runtime.upstream;
    if (upstream?.release && upstream.release !== pinned?.release) {
      // Not a warning. A newer upstream release is normal, and the pin is the point:
      // it is the version whose behaviour somebody actually confirmed.
      ctx.io.out(
        `  upstream  ${upstream.release} ${ctx.style.dim('released, not yet verified here')}`,
      );
    }
    if (pinned?.note) {
      ctx.io.out(`  ${ctx.style.dim(truncate(pinned.note, 140))}`);
    }
    ctx.io.out('');
  }

  ctx.io.out(ctx.style.dim("Choose one with 'brain:' in your document's frontmatter."));
}

function truncate(text: string, limit: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
}
