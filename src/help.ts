import type { Io, Style } from './output.js';

export const TAGLINE = 'build an agent as a document, and deploy it to Agent Spaces';

/**
 * One screen, grouped by whether a command needs an account.
 *
 * The split is the honest thing to show: most of this tool is a document editor's
 * companion and needs nothing from anyone, and the commands that spend money on a
 * server are the ones that will ask you to log in.
 */
export function printHelp(io: Io, style: Style, version: string): void {
  io.out(`${style.bold('agent')} ${style.dim(version)} — ${TAGLINE}`);
  io.out('');
  io.out(style.bold('Usage'));
  io.out('  agent <command> [options]');
  io.out('');
  io.out(style.bold('Your document'));
  io.out('  init [dir]            start an agent.md (offline; --template <slug> to fetch one)');
  io.out('  validate [file]       have the platform read it and say what it would build');
  io.out('  explain [file]        the same, read out at length: wizard, env, tools, soul');
  io.out('');
  io.out(style.bold('What you can build on'));
  io.out('  templates             the platform’s example documents');
  io.out('  runtimes              which container each brain: resolves to');
  io.out('  models --provider p   a provider’s catalogue, cheapest first');
  io.out('  search [query]        the published agent catalogue');
  io.out('  doctor                node, reachability, and this directory’s document');
  io.out('');
  io.out(style.bold('Options'));
  io.out('  --json                machine-readable output');
  io.out('  --api <url>           point at another backend (or set AGENTSPACES_API)');
  io.out('  --no-color            plain text; NO_COLOR is honoured too');
  io.out('  -h, --help            this screen');
  io.out('  -v, --version         print the version');
  io.out('');
  io.out(
    style.dim(
      'Deploying, logs and chat need an account and are not in this release — see the README.',
    ),
  );
}
