/**
 * Failures a user is meant to read, as opposed to stack traces.
 *
 * Two exit codes and no more: 1 is "what you asked for did not work" (an invalid
 * project, an API that refused, a file that is not there) and 2 is "I did not
 * understand the command". A script can branch on that; a longer table would only
 * be a table nobody memorises.
 */
export class CliError extends Error {
  readonly exitCode: number;
  /** A second line, printed under the message. Usually the command to run next. */
  readonly hint: string | null;
  /** The platform's own error code, when the failure came from the API. */
  readonly code: string | null;

  constructor(
    message: string,
    options: { exitCode?: number; hint?: string | null; code?: string | null } = {},
  ) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? 1;
    this.hint = options.hint ?? null;
    this.code = options.code ?? null;
  }
}

/** The command line itself was wrong. Exits 2, and prints usage. */
export class UsageError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, { exitCode: 2, hint: hint ?? null });
    this.name = 'UsageError';
  }
}
