import { UsageError } from './errors.js';

/**
 * A hand-rolled parser, because the package has no runtime dependencies and this
 * is the only reason it would have needed one.
 *
 * Supports `--flag value`, `--flag=value`, bare boolean flags, `--no-<flag>` to
 * turn one off, and single-dash aliases declared by the caller. Everything after a
 * literal `--` is a positional, which is what lets a document be named `--weird`.
 */
export interface ParsedArgs {
  /** The first non-flag token, or null when the line is only flags. */
  command: string | null;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

const ALIASES: Readonly<Record<string, string>> = {
  h: 'help',
  v: 'version',
  j: 'json',
  t: 'template',
  f: 'force',
};

/** Flags that always take a value, so `--api https://…` does not read as boolean. */
const VALUE_FLAGS = new Set([
  'api',
  'template',
  'provider',
  'key',
  'file',
  'category',
  'brain',
]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  let onlyPositionals = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (onlyPositionals) {
      positionals.push(token);
      continue;
    }

    if (token === '--') {
      onlyPositionals = true;
      continue;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      if (body.length === 0) continue;

      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }

      if (body.startsWith('no-')) {
        flags.set(body.slice(3), false);
        continue;
      }

      const next = argv[i + 1];
      if (VALUE_FLAGS.has(body)) {
        if (next === undefined || next.startsWith('-')) {
          throw new UsageError(`--${body} needs a value.`);
        }
        flags.set(body, next);
        i++;
        continue;
      }

      flags.set(body, true);
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      // Single-dash flags are aliases only, and never bundled: `-hv` is a typo
      // far more often than it is two flags, and guessing is worse than saying so.
      const name = ALIASES[token.slice(1)];
      if (!name) throw new UsageError(`Unknown option '${token}'.`);
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(name)) {
        if (next === undefined || next.startsWith('-')) {
          throw new UsageError(`-${token.slice(1)} needs a value.`);
        }
        flags.set(name, next);
        i++;
        continue;
      }
      flags.set(name, true);
      continue;
    }

    positionals.push(token);
  }

  const command = positionals.length > 0 ? positionals[0]! : null;
  return { command, positionals: positionals.slice(1), flags };
}

/** A flag's value as a string, or null when it was absent or given as a boolean. */
export function stringFlag(args: ParsedArgs, name: string): string | null {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : null;
}

/** A flag as a boolean. `--no-color` reads as false, an absent flag as the default. */
export function boolFlag(args: ParsedArgs, name: string, fallback = false): boolean {
  const value = args.flags.get(name);
  if (value === undefined) return fallback;
  return value !== false && value !== 'false';
}
