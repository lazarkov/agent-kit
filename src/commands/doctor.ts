import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { unwrap } from '../api.js';
import type { ParsedArgs } from '../args.js';
import type { Context } from '../context.js';
import { DEFAULT_DOCUMENT } from '../document.js';
import { CliError } from '../errors.js';
import { jsonOut } from '../output.js';
import { isProject, loadSource, MANIFEST } from '../project.js';
import type { BlueprintPreview, RuntimeInfo } from '../types.js';

const MINIMUM_NODE = [20, 11] as const;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Answers "is it me, or is it them" before anything expensive is attempted.
 *
 * Every check is something that has actually gone wrong for somebody: a Node too old
 * for the bin to parse, an API address that resolves to nothing, and a document in
 * the working directory that has never been read back by the platform.
 */
export async function doctor(ctx: Context, _args: ParsedArgs): Promise<void> {
  const checks: Check[] = [nodeCheck()];

  checks.push(await apiCheck(ctx));

  if (isProject(ctx.cwd) || existsSync(join(ctx.cwd, DEFAULT_DOCUMENT))) {
    checks.push(await agentCheck(ctx));
  } else {
    checks.push({
      name: 'agent',
      ok: true,
      detail: `no ${MANIFEST} here: run 'agent init' to scaffold a project`,
    });
  }

  if (ctx.json) {
    jsonOut(ctx.io, { ok: checks.every((check) => check.ok), checks });
  } else {
    for (const check of checks) {
      const mark = check.ok ? ctx.style.green('ok  ') : ctx.style.red('fail');
      ctx.io.out(`${mark} ${check.name.padEnd(9)} ${ctx.style.dim(check.detail)}`);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    // Exits non-zero so this is usable as a CI step, and names the first failure so
    // the exit code is not the only thing a log carries.
    throw new CliError(`${failed.length} check(s) failed: ${failed[0]!.name}.`);
  }
}

function nodeCheck(): Check {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const ok =
    major > MINIMUM_NODE[0] || (major === MINIMUM_NODE[0] && minor >= MINIMUM_NODE[1]);
  return {
    name: 'node',
    ok,
    detail: ok
      ? `v${process.versions.node}`
      : `v${process.versions.node}; this package needs v${MINIMUM_NODE[0]}.${MINIMUM_NODE[1]} or newer`,
  };
}

async function apiCheck(ctx: Context): Promise<Check> {
  try {
    const list = unwrap<RuntimeInfo[]>(await ctx.api.get('/agents/runtimes'));
    return {
      name: 'api',
      ok: true,
      detail: `${ctx.api.baseUrl} — ${list.map((runtime) => runtime.brain).join(', ')}`,
    };
  } catch (err) {
    return { name: 'api', ok: false, detail: (err as Error).message };
  }
}

async function agentCheck(ctx: Context): Promise<Check> {
  try {
    const agent = loadSource(ctx.cwd);
    const preview = unwrap<BlueprintPreview>(
      await ctx.api.post('/agents/blueprints/validate', { source: agent.source }),
    );
    return {
      name: 'agent',
      ok: true,
      detail: `this ${agent.kind} is valid: ${preview.id} on ${preview.brain ?? 'hermes'}`,
    };
  } catch (err) {
    return { name: 'agent', ok: false, detail: (err as Error).message };
  }
}
