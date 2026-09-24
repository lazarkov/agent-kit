# agent-kit

Build an agent as a document, and deploy it to [Agent Spaces](https://eu.agentspaces.app).

One Markdown file describes the whole agent — what it is told it is, what it is
allowed to touch, what it is asked for before it starts, what it does on a
schedule. The same document runs on either runtime the platform supports, so
choosing between Hermes and OpenClaw is one line of frontmatter rather than a
rewrite.

```bash
npm install -g agent-kit

agent init inbox-helper     # writes inbox-helper/agent.md
cd inbox-helper
agent validate              # the platform reads it back and says what it would build
agent explain               # the same, at length: wizard, environment, tools, soul
```

`agent-kit` and `agent` are the same program; use whichever reads better in your
shell.

## What is in this release

Everything here works without an account, because none of it costs anyone a
server:

| Command | What it does |
| --- | --- |
| `agent init [dir]` | Start an `agent.md`. Offline — the starter template ships in the package. |
| `agent init [dir] --template <slug>` | Start from one of the platform's examples instead. |
| `agent validate [file]` | Have the platform parse your document and report the agent it describes. |
| `agent explain [file]` | The long form: the wizard, the environment keys, the toolsets, the soul. |
| `agent templates` | The example documents, each adding one part of the format to the last. |
| `agent runtimes` | Which container image each `brain:` resolves to, and what was verified when. |
| `agent models --provider <p>` | A provider's catalogue, cheapest first, with tool support marked. |
| `agent search [query]` | The published catalogue. `--verified`, `--brain`, `--category`. |
| `agent doctor` | Node, reachability, and whether the document in this directory is valid. |

Options: `--json` for machine-readable output, `--api <url>` (or `AGENTSPACES_API`)
to point at another backend, `--no-color` (`NO_COLOR` is honoured too). Exit codes
are `0`, `1` for a failure and `2` for a command line that did not parse.

## Where the login line falls

Reading is anonymous. Spending is not.

- **No account, no network.** `init`, and the vendored starter template.
- **No account, network.** `validate`, `explain`, `templates`, `runtimes`,
  `models`, `search`, `doctor`. All of these are public reads on the platform.
- **Account required, and not yet in this release.** `deploy`, `list`, `logs`,
  `chat`, `start`/`stop`, and anything else that provisions or talks to a running
  container. Those spend money on a server, so they need to know whose money.

Deploying from the terminal needs a credential the platform does not issue yet —
its API accepts a Firebase ID token and nothing else, which is a browser's
artefact rather than a CLI's. Until that exists, deploy your document through the
web app: it takes the same file.

## Why there is no parser in here

The blueprint format belongs to the backend, which validates it section by section
and answers with the section it objected to and the likely fix. A second
implementation out here would drift within a release, and it would drift in the
worst direction — passing documents the platform then refuses. So `validate` and
`explain` ask, and print what they are told.

That is also why they need the network while `init` does not.

## The document

````markdown
---
id: inbox-helper
version: 0.1.0
name: Inbox Helper
description: Sorts a support inbox and escalates what it cannot answer.
category: productivity
tags: [Support]
---

## Runtime

```yaml
defaultModel: anthropic/claude-sonnet-4.6
toolsets: [terminal, file, memory]
```

## Soul

You are …
````

Ten sections are recognised — Config, Onboarding, Environment, Runtime, Schedule,
Setup, Test, Diagnostics, Files, Soul — and an unknown heading is an error with a
did-you-mean. Prose outside them is yours; it is not sent to the agent. Run
`agent templates` and `agent init --template 04-everything` to see the format used
in anger.

## Contributing

Yes, please — especially another deploy target or another runtime. See
[CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
