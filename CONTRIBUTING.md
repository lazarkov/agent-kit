# Contributing

This is meant to be contributed to. The interesting work is not in the CLI plumbing
— it is in making one document deploy to one more place.

## Getting set up

```bash
npm install
npm run check      # typecheck, then the whole suite
node dist/cli.js --help
```

`npm run build` compiles to `dist/`. There are no runtime dependencies and the aim
is to keep it that way: this package gets installed globally alongside other
people's toolchains, and every dependency is one they did not ask for. The arg
parser, the colours and the HTTP client are a few dozen lines each for that reason.
A dev dependency is fine.

## The rules that are actually load-bearing

**No blueprint parser in this repository.** The format belongs to the backend, which
validates section by section and answers with the offending section and a
did-you-mean. A copy out here would drift, and it would drift toward accepting
documents the platform then refuses. Ask it: `POST /agents/blueprints/validate`.

**Anonymous by default.** A command that only reads must not require an account.
The platform's public routes — validate, examples, runtimes, llm-models, types —
are public on purpose, and a login prompt in front of `agent validate` would be a
worse tool for no gain. Login belongs in front of the commands that provision.

**Errors are the platform's own words.** When the API refuses, print its `message`
and its `details`. Rewording loses the part that tells the author what to fix.
Never print a stack trace or an internal path at somebody who mistyped a heading.

**Tests do not use the network.** Fixtures in `test/` are transcribed from live
responses; a suite that needed egress would fail on a train rather than when
something is broken. `test/helpers.ts` has a fake `ApiClient` that records calls.

**Secrets are arguments, never files.** `--key` is passed through to the one request
that needs it and is not written anywhere. If you add a command that handles a
token, it does not get logged, echoed, or cached to disk without a decision being
made about it in the pull request.

## Adding a command

1. A module in `src/commands/`, exporting `(ctx, args) => Promise<void>`. `ctx`
   carries `io`, `api`, `style`, `json`, `cwd` and `env` — take everything from
   there rather than reaching for `console` or `process`, which is what makes it
   testable.
2. Register it in `COMMANDS` in `src/run.ts` and add a line to `src/help.ts`.
3. Handle `--json`: someone will script it.
4. Tests in `test/`, using `fakeApi`. Assert on the words a user reads, not only on
   the exit code.

## Adding a runtime or a deploy target

The premise of this package is that a document is portable and the runtime is a
choice. Today `brain:` selects between Hermes and OpenClaw on the platform's side.
If you want a third — or a deploy target that is not Agent Spaces at all — open an
issue first with the shape of the adapter you have in mind. The seam has to be
designed once rather than three times.

## Pull requests

Small, and with a reason in the message. `npm run check` green. If a change is
about wording a user reads, quote the before and after — that is the product here
as much as the code is.
