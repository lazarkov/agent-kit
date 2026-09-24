/**
 * Printing. Raw ANSI rather than a colour library, for the same reason as the arg
 * parser: it is thirty lines, and a dependency in a CLI is a dependency in every
 * project that installs one.
 */

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export const consoleIo: Io = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

const CODES = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  cyan: '[36m',
} as const;

export class Style {
  constructor(private readonly enabled: boolean) {}

  private wrap(code: string, text: string): string {
    return this.enabled ? `${code}${text}${CODES.reset}` : text;
  }

  bold(text: string): string {
    return this.wrap(CODES.bold, text);
  }
  dim(text: string): string {
    return this.wrap(CODES.dim, text);
  }
  red(text: string): string {
    return this.wrap(CODES.red, text);
  }
  green(text: string): string {
    return this.wrap(CODES.green, text);
  }
  yellow(text: string): string {
    return this.wrap(CODES.yellow, text);
  }
  cyan(text: string): string {
    return this.wrap(CODES.cyan, text);
  }
}

/**
 * Colour is on for a terminal and off for a pipe, with `NO_COLOR` and `--no-color`
 * both winning. Honouring NO_COLOR matters here because the most likely non-tty
 * consumer of this tool is a CI log.
 */
export function shouldColor(options: {
  tty: boolean;
  noColorFlag: boolean;
  env: Record<string, string | undefined>;
}): boolean {
  if (options.noColorFlag) return false;
  if (options.env.NO_COLOR !== undefined && options.env.NO_COLOR !== '') return false;
  if (options.env.FORCE_COLOR !== undefined && options.env.FORCE_COLOR !== '0') return true;
  return options.tty;
}

/** Two columns, padded to the longest label. Used by every list this tool prints. */
export function table(rows: readonly [string, string][], gap = 2): string[] {
  const width = rows.reduce((max, row) => Math.max(max, row[0].length), 0);
  return rows.map(([label, value]) => `${label.padEnd(width)}${' '.repeat(gap)}${value}`);
}

/**
 * Model prices arrive as dollars per token, which is unreadable. Per million is the
 * unit every provider quotes, and a free model should say so rather than say $0.00.
 */
export function formatPrice(perToken: number | null | undefined): string {
  if (perToken === null || perToken === undefined) return '—';
  if (perToken === 0) return 'free';
  const perMillion = perToken * 1_000_000;
  const decimals = perMillion < 1 ? 3 : 2;
  return `$${perMillion.toFixed(decimals)}/M`;
}

export function jsonOut(io: Io, value: unknown): void {
  io.out(JSON.stringify(value, null, 2));
}
