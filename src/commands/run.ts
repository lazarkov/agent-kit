import { existsSync, readFileSync } from 'node:fs';
import { basename, join, posix, relative } from 'node:path';

import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { boolFlag, stringFlag } from '../args.js';
import type { Context } from '../context.js';
import { CliError, UsageError } from '../errors.js';
import { readScalar } from '../frontmatter.js';
import {
  answersFrom,
  containerName,
  containerState,
  dockerShell,
  homeOf,
  localRuntime,
  removeContainer,
  resolvePlaceholders,
  runAsAgent,
  startContainer,
  userOf,
  writeFile,
} from '../local.js';
import type { Container, Shell } from '../local.js';
import { jsonOut } from '../output.js';
import { declaredFiles, isProject, MANIFEST } from '../project.js';
import { resolveTarget, toBlueprintId } from '../paths.js';
import type { RuntimeInfo } from '../types.js';

/**
 * Where a local run gets real values.
 *
 * `.env` is committed and holds placeholders, so it cannot hold a key. This file is
 * gitignored by `agent init` from the first commit, and it does two jobs at once: its
 * lines are the container's environment, and they are also the answers to the
 * project's placeholders, since `TEAM_NAME=Platform` is how an environment spells
 * `{{teamName}}`.
 */
const LOCAL_ENV = '.env.local';

/** A step that ran inside the container, reported the same way whoever ran it reads. */
interface Step {
  command?: string;
  code: number;
  output: string;
}

/**
 * Run the project here, in the image the cloud would run it in.
 *
 * The loop this exists for: place the files, set the environment, run the setup, run
 * the test and talk to the agent, all before a server exists anywhere and without an
 * account. A local container is also stricter than the cloud in one way worth having:
 * everything it runs runs as the agent's own user, so a file the agent cannot read
 * fails here instead of becoming an agent that quietly answers as somebody else.
 */
export async function localRun(ctx: Context, args: ParsedArgs): Promise<void> {
  const dir = resolveTarget(ctx.cwd, args.positionals[0]);
  if (!isProject(dir)) {
    // A document would have to be taken apart to be placed in a container, and taking
    // one apart needs the blueprint parser this package deliberately does not have.
    throw new UsageError(
      `No ${MANIFEST} in ${relative(ctx.cwd, dir) || 'this directory'}.`,
      `A local run needs a project directory. Run 'agent init' to scaffold one.`,
    );
  }

  const manifest = readFileSync(join(dir, MANIFEST), 'utf8');
  const brain = readScalar(manifest, 'brain') ?? 'hermes';
  const id = readScalar(manifest, 'id') ?? toBlueprintId(basename(dir));
  const name = containerName(id);
  const shell: Shell = ctx.shell ?? dockerShell;

  // Before the brain is resolved, because a container you cannot name a runtime for is
  // exactly the one you most want to be able to remove.
  if (boolFlag(args, 'down')) {
    const removed = await removeContainer(shell, name);
    if (ctx.json) return jsonOut(ctx.io, { container: name, removed });
    ctx.io.out(removed ? `removed  ${name}` : `${ctx.style.dim('nothing to remove')}  ${name}`);
    return;
  }

  const runtime = localRuntime(brain);
  // Read before anything is started, not when the moment comes to run it: `--test` on a
  // project that declares no test is answerable from the directory alone, and finding
  // out after a container is up leaves one behind to be cleaned up for nothing.
  const declaredTest = boolFlag(args, 'test') ? testCommand(dir) : null;
  const image = stringFlag(args, 'image') ?? (await pinnedImage(ctx, brain));

  // Rebuilt rather than reused, because the question a local run answers is whether a
  // fresh container comes up with this project in it. Writing today's files over
  // yesterday's, in a container that already ran its setup, answers a different one.
  if ((await containerState(shell, name)) !== null) await removeContainer(shell, name);

  await startContainer(shell, { name, image, brain });
  const home = await homeOf(shell, name, brain);
  const container: Container = {
    name,
    image,
    brain,
    home,
    user: await userOf(shell, name, home),
  };

  const local = read(dir, LOCAL_ENV);
  const answers = answersFrom(local);
  // The one answer that is the runtime's rather than the author's, and the reason
  // `files/home/...` does not have to know where a given brain keeps its files.
  answers.set('home', home);

  const unanswered = new Set<string>();
  const resolve = (text: string): string => {
    const result = resolvePlaceholders(text, answers);
    for (const key of result.unresolved) unanswered.add(key);
    return result.text;
  };

  const placed: string[] = [];
  const place = async (path: string, contents: string): Promise<void> => {
    await writeFile(shell, container, path, `${contents.trimEnd()}\n`);
    placed.push(path);
  };

  // The environment first. The setup script below reads it and so does the agent, and
  // a setup that runs before its own variables exist fails for the wrong reason.
  const env = containerEnv(read(dir, '.env'), local);
  if (env.trim().length > 0) await place(posix.join(home, '.env'), resolveEnv(env, resolve));

  for (const file of declaredFiles(dir)) {
    // A `.when` sidecar is a condition, and an unanswered condition means the file is
    // not for this deploy. Same rule the platform applies to `when:` on a file.
    if (file.when && !answers.get(file.when)) continue;
    await place(resolve(file.containerPath), resolve(file.contents));
  }

  const soul = read(dir, 'soul.md');
  if (soul.trim().length > 0) {
    await place(posix.join(home, runtime.systemPromptFile), resolve(soul));
  }

  const setup = existsSync(join(dir, 'setup.sh'))
    ? await step(shell, container, resolve(read(dir, 'setup.sh')))
    : null;

  let test: Step | null = null;
  if (declaredTest !== null) {
    const command = resolve(declaredTest);
    test = { command, ...(await step(shell, container, command)) };
  }

  if (ctx.json) {
    return jsonOut(ctx.io, {
      container: name,
      image,
      brain,
      home,
      user: container.user,
      placed,
      unanswered: [...unanswered],
      setup,
      test,
    });
  }

  report(ctx, { container, placed, unanswered: [...unanswered], setup, test, runtime });
}

/**
 * The environment, resolved, with anything still unanswered commented out.
 *
 * The one place a leftover `{{...}}` cannot simply be left standing. Everywhere else it
 * is a visible reminder in a file the agent reads as text, but this file gets sourced,
 * and `KEY={{a | b}}` is a shell syntax error that makes every later line in it fail
 * too. Commented out, the variable is unset, which is what an unanswered variable means
 * anyway, and the line is still there to be read. The caller names them all regardless.
 */
function resolveEnv(body: string, resolve: (text: string) => string): string {
  return resolve(body)
    .split(/\r?\n/)
    .map((line) => (line.includes('{{') && !line.trim().startsWith('#') ? `# ${line}` : line))
    .join('\n');
}

/** What the container's `.env` should say: the project's, with local extras appended. */
function containerEnv(declared: string, local: string): string {
  const names = new Set(
    declared
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('='))
      .map((line) => line.slice(0, line.indexOf('=')).trim()),
  );

  // A variable the project declares keeps the project's spelling, resolved from the
  // answer. One only `.env.local` has is a local-only variable, and goes in as it is:
  // it is how you try something out before deciding it belongs in the project.
  const extra = local
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#') || !trimmed.includes('=')) return false;
      return !names.has(trimmed.slice(0, trimmed.indexOf('=')).trim());
    })
    .join('\n');

  if (extra.trim().length === 0) return declared;
  return `${declared.trimEnd()}\n\n# from ${LOCAL_ENV}\n${extra}\n`;
}

async function step(shell: Shell, container: Container, command: string): Promise<Step> {
  const result = await runAsAgent(shell, container, command);
  return { code: result.code, output: `${result.stdout}${result.stderr}`.trim() };
}

/** The project's own test, as written, so `--test` can be refused before anything runs. */
function testCommand(dir: string): string {
  const body = read(dir, 'test.yaml');
  if (body.trim().length === 0) {
    throw new CliError('This project declares no test.', {
      hint: `Add test.yaml with a 'command:' line, or drop --test.`,
    });
  }

  // One key, read without a YAML parser for the same reason nothing else here is
  // parsed: the format belongs to the backend, and `command:` is the whole of it.
  const found = /^\s*command:\s*(.+)$/m.exec(body);
  if (!found?.[1]) {
    throw new CliError('test.yaml declares no command.', {
      hint: 'It is one line: command: <what to run inside the container>',
    });
  }
  return found[1].trim().replace(/^["'](.*)["']$/, '$1');
}

/**
 * The image the platform itself deploys for this brain, at the release it verified.
 *
 * Asked rather than written down here, because the pin is the whole value of it: a
 * local run that exercises some other build of the runtime has proved nothing about
 * the one you are about to deploy onto. `--image` exists for anyone testing an
 * unreleased runtime, and skips the network.
 */
async function pinnedImage(ctx: Context, brain: string): Promise<string> {
  const list = unwrap<RuntimeInfo[]>(await ctx.api.get('/agents/runtimes'));
  const found = list.find((runtime) => runtime.brain === brain);
  if (!found) {
    throw new CliError(`The platform has no runtime called '${brain}'.`, {
      hint: `Run 'agent runtimes' for the ones it has.`,
    });
  }
  const verified = found.verified?.[found.verified.length - 1];
  return verified?.image ?? found.image;
}

function report(
  ctx: Context,
  found: {
    container: Container;
    placed: readonly string[];
    unanswered: readonly string[];
    setup: Step | null;
    test: Step | null;
    runtime: { interactive: string };
  },
): void {
  const { io, style } = ctx;
  const { container } = found;

  io.out(`${style.green('running')}  ${container.name}  ${style.dim(container.image)}`);
  io.out(`  home    ${container.home}  ${style.dim(`owned by ${container.user}`)}`);
  for (const path of found.placed) io.out(`  placed  ${path}`);

  for (const [label, ran] of [
    ['setup', found.setup],
    ['test', found.test],
  ] as const) {
    if (!ran) continue;
    const mark = ran.code === 0 ? style.green('ok') : style.red(`exit ${ran.code}`);
    io.out(`  ${label.padEnd(6)}  ${mark}${ran.command ? `  ${style.dim(ran.command)}` : ''}`);
    // Enough to recognise a failure by, not enough to bury the rest of the report.
    for (const line of ran.output.split('\n').filter(Boolean).slice(0, 10)) {
      io.out(`          ${style.dim(line)}`);
    }
  }

  if (found.unanswered.length > 0) {
    io.out('');
    io.out(`${style.yellow('unanswered')}  ${found.unanswered.join(', ')}`);
    io.out(
      style.dim(
        `  Left standing rather than blanked. Answer them in ${LOCAL_ENV}: TEAM_NAME=Platform answers {{teamName}}.`,
      ),
    );
  }

  io.out('');
  io.out(`Talk to it   ${style.cyan(`docker exec -it ${container.name} ${found.runtime.interactive}`)}`);
  io.out(`Tear it down ${style.cyan('agent run --down')}`);
  io.out('');
  // Printed every time, because this is the one difference that is invisible from
  // inside the container and would otherwise be discovered after a deploy.
  io.out(style.dim("This is the runtime's own default config. The cloud renders a hardened one on"));
  io.out(style.dim('top, so approvals, the website blocklist and the toolsets differ there.'));
}

function read(dir: string, file: string): string {
  const path = join(dir, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
