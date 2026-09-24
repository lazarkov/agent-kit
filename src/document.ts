import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { CliError, UsageError } from './errors.js';

/** The conventional filename. One document is one agent, and it has one name. */
export const DEFAULT_DOCUMENT = 'agent.md';

/** What `POST /agents/blueprints` accepts before it refuses on size. */
export const MAX_SOURCE_BYTES = 64 * 1024;

export interface LoadedDocument {
  path: string;
  source: string;
}

/**
 * Finds the document a command should act on.
 *
 * With an argument, that argument: a file, or a directory holding `agent.md`.
 * Without one, `agent.md` in the working directory. No recursive search: a tool
 * that guesses which of two documents you meant is a tool you cannot trust with
 * `deploy`.
 */
export function loadDocument(cwd: string, target?: string | null): LoadedDocument {
  const candidate = target ? resolve(cwd, target) : join(cwd, DEFAULT_DOCUMENT);
  const path = existsSync(candidate) && statSync(candidate).isDirectory()
    ? join(candidate, DEFAULT_DOCUMENT)
    : candidate;

  if (!existsSync(path)) {
    if (target) {
      throw new UsageError(`No such file: ${target}`);
    }
    throw new UsageError(
      `No ${DEFAULT_DOCUMENT} in this directory.`,
      `Run 'agent init' to start one, or name a file: agent validate path/to/${DEFAULT_DOCUMENT}`,
    );
  }

  const source = readFileSync(path, 'utf8');
  guardSource(source, basename(path));
  return { path, source };
}

/**
 * The two refusals that apply to any source, however it was produced: read from a
 * file, or compiled out of a project directory. `label` is what the reader should go
 * and look at.
 */
export function guardSource(source: string, label: string): void {
  if (source.trim().length === 0) {
    throw new CliError(`${label} is empty.`);
  }

  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > MAX_SOURCE_BYTES) {
    // Checked here rather than left to the API, because the request would carry
    // the whole document across the wire only to be refused on arrival.
    throw new CliError(`${label} is ${Math.round(bytes / 1024)} KB; the limit is 64 KB.`, {
      hint: 'Move long reference material into a layer repository instead of the document.',
    });
  }
}
