import type { ApiClient } from './api.js';
import type { Shell } from './local.js';
import type { Io, Style } from './output.js';

/**
 * Everything a command is allowed to touch. Passed in rather than imported so a
 * test can run a command with a fake API and collect its output as strings.
 */
export interface Context {
  io: Io;
  api: ApiClient;
  style: Style;
  /** `--json`: print the payload and nothing else, for scripts and CI. */
  json: boolean;
  cwd: string;
  env: Record<string, string | undefined>;
  /**
   * How `agent run` reaches Docker. Absent everywhere but a test, which passes a fake
   * so the command can be exercised on a machine with no Docker in it.
   */
  shell?: Shell;
}
