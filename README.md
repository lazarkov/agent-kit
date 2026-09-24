# agent-kit

Build an agent as an ordinary project, and deploy it to
[Agent Spaces](https://eu.agentspaces.app).

An agent is a prompt, a runtime config, an environment, a setup script and whatever
files it needs on the box. Those are separate concerns, so they are separate files,
in a directory you can diff, review and put in git. The same project runs on either
runtime the platform supports, so choosing between Hermes and OpenClaw is one line
of config rather than a rewrite.

```bash
npm install -g agent-kit

agent init inbox-helper     # scaffolds the project
cd inbox-helper
$EDITOR soul.md             # the instructions: the part that must be yours
agent validate              # the platform reads the project and says what it would build
agent explain               # the same, at length: wizard, environment, tools, soul
```

`agent-kit` and `agent` are the same program; use whichever reads better in your
shell.

## The project

```
inbox-helper/
  agent.yaml        who it is: id, name, description, category, tags
  soul.md           its instructions, in Markdown
  config.yaml       model and toolsets
  .env              the variables the container gets, as KEY=value
  fields.yaml       what the person deploying it is asked for
  onboarding.yaml   the steps they walk through
  setup.sh          commands run once, when the container is built
  schedule.yaml     what it does on its own
  test.yaml         the command that proves it works
  diagnostics.yaml  what to check when it does not
  files/            files placed in the container
```

Only `agent.yaml` is required. Every other file is optional and is picked up the
moment it exists, so a project stays as small as the agent is.

`files/` mirrors the container: `files/home/notes/README.md` lands in the agent's own
directory, `files/etc/agent/rules.toml` at `/etc/agent/rules.toml`. A file is written
only when a condition holds if you put that condition in a sidecar, so
`files/home/telegram.json.when` containing `telegramToken` means the JSON is written
only for a deploy that supplied one.

`.env` is committed. It holds the variable names the container reads and the
placeholders they are filled from, like `{{llmKeyVar}}={{llmApiKey}}`, which resolve
when someone deploys the agent. Real keys are typed into the wizard and stored
encrypted, and never belong in the project.

## What is in this release

Everything here works without an account, because none of it costs anyone a server:

| Command | What it does |
| --- | --- |
| `agent init [dir]` | Scaffold a project. Offline: the scaffold ships in the package. |
| `agent init [dir] --template <slug>` | Start from one of the platform's worked examples instead. |
| `agent build [dir]` | Compile the project to the one document the API takes. `--emit` prints it. |
| `agent validate [dir]` | Have the platform read it and report the agent it describes. |
| `agent explain [dir]` | The long form: the wizard, the environment keys, the toolsets, the soul. |
| `agent templates` | The platform's examples, each adding one part of the format to the last. |
| `agent runtimes` | Which container image each `brain:` resolves to, and what was verified when. |
| `agent models --provider <p>` | A provider's catalogue, cheapest first, with tool support marked. |
| `agent search [query]` | The published catalogue. `--verified`, `--brain`, `--category`. |
| `agent doctor` | Node, reachability, and whether the project in this directory is valid. |

Options: `--json` for machine-readable output, `--api <url>` (or `AGENTSPACES_API`)
to point at another backend, `--no-color` (`NO_COLOR` is honoured too). Exit codes
are `0`, `1` for a failure and `2` for a command line that did not parse.

## Where the login line falls

Reading is anonymous. Spending is not.

- **No account, no network.** `init` and `build`.
- **No account, network.** `validate`, `explain`, `templates`, `runtimes`,
  `models`, `search`, `doctor`. All of these are public reads on the platform.
- **Account required, and not yet in this release.** `deploy`, `list`, `logs`,
  `chat`, `start`/`stop`, and anything else that provisions or talks to a running
  container. Those spend money on a server, so they need to know whose money.

Deploying from the terminal needs a credential the platform does not issue yet: its
API accepts a Firebase ID token and nothing else, which is a browser's artefact
rather than a CLI's. Until that exists, deploy through the web app. `agent build`
leaves the document it wants at `.agentspaces/agent.md`.

## What build produces, and why you can ignore it

The platform's API takes one document, so the project is concatenated into one before
it is sent: `agent.yaml` becomes the frontmatter, `soul.md` becomes `## Soul`,
`config.yaml` becomes `## Runtime`, and so on down the list. It is a build artefact,
it goes in `.agentspaces/` which `init` gitignores, and nothing reads it back. Run
`agent build --emit` when you want to see exactly what the platform was given.

Every file goes in verbatim, `.env` aside, which becomes the YAML pairs that section
expects. That is deliberate: it means an error the platform reports is an error in
text you actually wrote.

## Why there is no parser in here

The blueprint format belongs to the backend, which validates it section by section
and answers with the section it objected to and the likely fix. A second
implementation out here would drift within a release, and it would drift in the worst
direction, passing agents the platform then refuses. So `validate` and `explain` ask,
and print what they are told.

That is also why they need the network while `init` and `build` do not. It is also
why `--template` writes a single document rather than a project: taking an example
apart again would need exactly the parser this package does not have. Every command
accepts either shape.

## Contributing

Yes, please, especially another deploy target or another runtime. See
[CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
