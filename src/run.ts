import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ApiClient, DEFAULT_API } from './api.js';
import { boolFlag, parseArgs, stringFlag } from './args.js';
import type { ParsedArgs } from './args.js';
import { build } from './commands/build.js';
import { doctor } from './commands/doctor.js';
import { explain } from './commands/explain.js';
import { init } from './commands/init.js';
import { models } from './commands/models.js';
import { runtimes } from './commands/runtimes.js';
import { search } from './commands/search.js';
import { templates } from './commands/templates.js';
import { validate } from './commands/validate.js';
import type { Context } from './context.js';
import { CliError, UsageError } from './errors.js';
import { printHelp } from './help.js';
import { consoleIo, shouldColor, Style } from './output.js';
import type { Io } from './output.js';
import { packageRoot } from './paths.js';

type Command = (ctx: Context, args: ParsedArgs) => Promise<void>;

/** Exported so a test can insist every command here is documented and exercised. */
export const COMMANDS: Record<string, Command> = {
  init,
  build,
  validate,
  explain,
  templates,
  runtimes,
  models,
  search,
  doctor,
};

export interface RunOptions {
  io?: Io;
  cwd?: string;
  env?: Record<string, string | undefined>;
  tty?: boolean;
  api?: ApiClient;
}

/**
 * The whole CLI as a function, so a test can run `['validate']` with a fake API and
 * read what it printed. `main` below is the only part that knows about exit codes.
 */
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const io = options.io ?? consoleIo;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const args = parseArgs(argv);

  const style = new Style(
    shouldColor({
      tty: options.tty ?? process.stdout.isTTY === true,
      noColorFlag: args.flags.get('color') === false,
      env,
    }),
  );

  if (boolFlag(args, 'version')) {
    io.out(version());
    return 0;
  }

  if (args.command === null || args.command === 'help' || boolFlag(args, 'help')) {
    // `agent help validate` is `agent validate --help` said the other way round; both
    // land here, and neither is an error, so both exit 0.
    printHelp(io, style, version());
    return 0;
  }

  const command = COMMANDS[args.command];
  if (!command) {
    throw new UsageError(
      `Unknown command '${args.command}'.`,
      `Try one of: ${Object.keys(COMMANDS).join(', ')}`,
    );
  }

  const api =
    options.api ?? new ApiClient(stringFlag(args, 'api') ?? env.AGENTSPACES_API ?? DEFAULT_API);

  await command({ io, api, style, json: boolFlag(args, 'json'), cwd, env }, args);
  return 0;
}

let cachedVersion: string | null = null;

function version(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const manifest = JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    cachedVersion = manifest.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

/**
 * The bin's body. Lives here rather than in `cli.ts` so that importing any of this
 * from a test cannot start a program; `cli.ts` is two lines and calls this.
 */
export async function main(): Promise<void> {
  const io = consoleIo;
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (err) {
    const style = new Style(
      shouldColor({ tty: process.stderr.isTTY === true, noColorFlag: false, env: process.env }),
    );

    if (err instanceof CliError) {
      // The platform's own wording, unedited, plus its hint. Nothing about this
      // package's internals: the reader's document is what went wrong, not our stack.
      io.err(`${style.red('error')} ${err.message}`);
      if (err.hint) io.err(`      ${style.dim(err.hint)}`);
      if (err instanceof UsageError) io.err(`      ${style.dim("Run 'agent --help' for usage.")}`);
      process.exitCode = err.exitCode;
      return;
    }

    io.err(`${style.red('error')} ${(err as Error).message}`);
    io.err(style.dim('      This one is a bug in the CLI. Please report it with the command you ran.'));
    process.exitCode = 1;
  }
}
