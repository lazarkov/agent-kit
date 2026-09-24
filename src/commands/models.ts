import type { ParsedArgs } from '../args.js';
import { boolFlag, stringFlag } from '../args.js';
import type { Context } from '../context.js';
import { UsageError } from '../errors.js';
import { formatPrice, jsonOut, table } from '../output.js';
import type { LlmModelsResponse } from '../types.js';

/** The providers the platform knows how to read a catalogue from. */
const PROVIDERS = ['openrouter', 'requesty', 'anthropic', 'openai', 'ollama-cloud'];

/**
 * A provider's catalogue, as the platform sees it.
 *
 * This matters more than it sounds: `defaultModel` in a document has to be a name
 * the chosen provider actually serves, and the failure when it is not is an agent
 * that deploys, starts, and answers nothing. Some providers need a key to list,
 * `--key` is passed through for that one call and never written to disk.
 */
export async function models(ctx: Context, args: ParsedArgs): Promise<void> {
  const provider = stringFlag(args, 'provider') ?? args.positionals[0] ?? null;
  if (!provider) {
    throw new UsageError('Which provider?', `One of: ${PROVIDERS.join(', ')}`);
  }

  const key = stringFlag(args, 'key') ?? ctx.env.LLM_API_KEY ?? null;
  const response = await ctx.api.post<LlmModelsResponse>('/agents/llm-models', {
    provider,
    ...(key === null ? {} : { apiKey: key }),
  });

  let list = response.models ?? [];
  if (boolFlag(args, 'free')) list = list.filter((model) => model.free);
  if (boolFlag(args, 'tools')) list = list.filter((model) => model.toolCapable);

  if (ctx.json) {
    jsonOut(ctx.io, { provider: response.provider, models: list });
    return;
  }

  if (list.length === 0) {
    ctx.io.out(`No models matched for ${provider}.`);
    return;
  }

  // Cheapest first, free at the top: the question this list answers is usually
  // "what can I run this on without it costing much".
  const sorted = [...list].sort(
    (a, b) => (a.promptPrice ?? Infinity) - (b.promptPrice ?? Infinity),
  );

  const rows: [string, string][] = sorted.map((model) => [
    model.id,
    [
      formatPrice(model.promptPrice),
      model.contextLength ? `${Math.round(model.contextLength / 1000)}k ctx` : null,
      // An agent without tool calling cannot use its own terminal, which is most of
      // what an agent here is for. Worth saying on every line.
      model.toolCapable === false ? ctx.style.yellow('no tools') : null,
    ]
      .filter(Boolean)
      .join('  '),
  ]);

  for (const line of table(rows)) ctx.io.out(line);
  ctx.io.out('');
  ctx.io.out(
    ctx.style.dim(
      `${sorted.length} model(s) from ${response.provider}. Prices are per million prompt tokens.`,
    ),
  );
}
