# agent-kit

A tool for building an agent, reusing someone else's, or changing one you already
have, and then deploying it to the cloud. Open source throughout, agents included.

An agent is a prompt, a runtime config, an environment, a setup script and whatever
files it needs on the box. Those are separate concerns, so they are separate files, in
a directory you can diff, review and put in git.

The agent itself runs on an open source runtime, [Hermes](https://github.com/nousresearch/hermes-agent)
or [OpenClaw](https://github.com/openclaw/openclaw), and more can be added. Which one
is one line in `config.yaml`, so moving an agent from Hermes to OpenClaw or back is an
edit rather than a rewrite. Deployment is the same story: today the cloud that takes
these agents is [Agent Spaces](https://eu.agentspaces.app), and another deploy target
can be added without changing the project.

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

## Architecture

Four layers, and you can change any one of them without touching the others.

1. **Your project.** A directory of files. Start it from scratch, or start from a
   template, or open one you already have.
2. **agent-kit.** Builds the project into the single document a cloud accepts, and
   asks the cloud what it makes of that document before anything is provisioned.
3. **The cloud.** Provisions a server, puts your agent in a container on it, and runs
   it. Agent Spaces today, and the interface is small enough that another one is a
   matter of another implementation.
4. **The runtime.** Hermes or OpenClaw, inside that container, doing the thinking.
   `brain:` in `config.yaml` picks it.

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ your own project             │   │ or a template                │
│                              │   │                              │
│ agent.yaml    soul.md        │   │ agent init --template <slug> │
│ config.yaml   .env           │   │ is one of the platform's     │
│ fields.yaml   files/         │   │ examples, as one document    │
└──────────────┬───────────────┘   └──────────────┬───────────────┘
               └─────────────────┬────────────────┘
                 ┌───────────────┴───────────────┐
                 │ agent-kit                     │
                 │                               │
                 │ build     one document        │
                 │ validate  what a cloud makes  │
                 │ explain   of it, up front     │
                 └───────────────┬───────────────┘
              ┌──────────────────┴──────────────────┐
   ┌──────────┴───────────┐            ┌────────────┴─────────────┐
   │ Agent Spaces         │            │ somewhere else           │
   │ the cloud that takes │            │ planned: same project,   │
   │ it today             │            │ another target           │
   └──────────┬───────────┘            └──────────────────────────┘
   ┌──────────┴────────────────────────────────────┐
   │ a container on a server of its own            │
   │ your files, your environment, your soul       │
   └──────────────────────┬────────────────────────┘
          ┌───────────────┴───────────────┐
   ┌──────┴─────────────┐    ┌────────────┴───────┐
   │ Hermes             │    │ OpenClaw           │
   │ brain: hermes      │    │ brain: openclaw    │
   └────────────────────┘    └────────────────────┘
```

## Commands

`Login` is whether the command needs an account. Nothing in this release does, because
none of it provisions a server.

| Command | What it does | Login |
| --- | --- | --- |
| `agent init [dir]` | Scaffold a project. Works offline: the scaffold ships in the package. | no |
| `agent init [dir] --template <slug>` | Start from one of the platform's worked examples instead. | no |
| `agent build [dir]` | Compile the project to the one document a cloud takes, at `.agentspaces/agent.md`. `--emit` prints it instead. | no |
| `agent validate [dir]` | Have the platform read it and report the agent it describes. | no |
| `agent explain [dir]` | The long form: the wizard, the environment keys, the toolsets, the soul. | no |
| `agent templates` | The platform's examples, each adding one part of the format to the last. | no |
| `agent runtimes` | Which container image each `brain:` resolves to, and what was verified when. | no |
| `agent models --provider <p>` | A provider's catalogue, cheapest first, with tool support marked. | no |
| `agent search [query]` | The published catalogue. `--verified`, `--brain`, `--category`. | no |
| `agent doctor` | Node, reachability, and whether the project in this directory is valid. | no |
| `deploy`, `list`, `logs`, `chat`, `start`, `stop` | Not here yet. They provision or talk to a running container, so they spend money on a server and have to know whose. Deploy through the web app meanwhile, and give it what `agent build` wrote. | yes |

Options: `--json` for machine-readable output, `--api <url>` (or `AGENTSPACES_API`)
to point at another backend, `--no-color` (`NO_COLOR` is honoured too). Exit codes
are `0`, `1` for a failure and `2` for a command line that did not parse.

Everything takes either shape, a project directory or a single document, so a template
is read the same way a directory is.

## Contributing

Yes, please, especially another deploy target or another runtime. See
[CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
