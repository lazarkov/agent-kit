---
name: agent-kit
description: Build, change, test or deploy an AI agent as a project of files using the agent-kit CLI (`agent` / `agent-kit`), for Hermes or OpenClaw runtimes on Agent Spaces. Use when someone asks to make an agent, edit an agent's soul or prompt, run an agent locally in Docker, validate or explain an agent project, browse the agent catalogue or templates, or pick a model for one.
---

# agent-kit

An agent here is a directory of files, not code. You write its instructions, its model
and its environment as files, ask the platform to read them back, run it in a container
on this machine, and hand the result to a cloud. This skill is the operating procedure,
so you do not need to read the README.

Check it is installed first: `agent --version`. If that fails, `npm i -g agent-kit`.
Every command takes an optional directory, defaulting to the current one, and also
accepts a single built document in place of a directory.

## The loop

1. `agent init <dir>` scaffolds the project. Offline, and the scaffold is commented.
2. Edit the files. `soul.md` is the part that must be yours.
3. `agent validate <dir>`. The platform reads it and reports the agent it would build.
   This is the only authority on whether the project is correct.
4. `agent run <dir> --test`. Starts a container from the image the cloud deploys,
   places the project in it, runs `setup.sh` and `test.yaml`. Needs Docker.
5. `agent build <dir>` writes `.agentspaces/agent.md`, the single document a cloud
   takes. Deploying is done through the web app, which is given that document.

Do not skip step 3 before step 4: validate costs a second and a container costs a
minute, and validate is what catches a field name the platform does not know.

## Which file holds what

Only `agent.yaml` is required. Every other file is optional and is picked up the moment
it exists, so a project stays as small as the agent is.

- `agent.yaml` is who it is: `id`, `version`, `name`, `description`, `category`, `tags`.
- `soul.md` is its instructions, in Markdown. Write it as rules addressed to the agent.
- `config.yaml` is `defaultModel` and `toolsets`. `brain:` here picks the runtime,
  `hermes` or `openclaw`, and defaults to hermes.
- `.env` is the container's environment as `KEY=value`. Committed, so it holds names
  and placeholders only.
- `fields.yaml` is what the person deploying it is asked for.
- `onboarding.yaml` is the steps they walk through.
- `setup.sh` runs once when the container is built.
- `schedule.yaml` is what the agent does on its own.
- `test.yaml` is one line, `command:`, that proves the agent works.
- `diagnostics.yaml` is what to check when it does not.
- `files/` mirrors the container: `files/home/notes/README.md` lands in the agent's own
  directory, `files/etc/agent/rules.toml` at `/etc/agent/rules.toml`. Add a sidecar to
  make a file conditional: `files/home/telegram.json.when` containing `telegramToken`
  writes the JSON only for a deploy that supplied one.

## Rules

**Never put a real key, token or password in any committed file.** `.env` holds
`{{placeholders}}`, and a real value there is a published credential. Real values for a
local run go in `.env.local`, which `agent init` gitignores. Real values for a deploy
are typed into the wizard and stored encrypted.

**A placeholder is answered from `fields.yaml`, so the two have to agree.** `{{teamName}}`
in any file is filled from the field with `key: teamName`. `{{a | b}}` tries `a` then
`b`, and `{{a | "literal"}}` ends in a literal. `{{home}}` is the agent's own directory
and is supplied by the runtime, so never hardcode `/opt/data`.

**Add a field and you also add a step.** A field of your own in `fields.yaml` needs a
`panel: config` step in `onboarding.yaml` or nobody is ever asked for it. `agent validate`
says so if you forget.

**Do not invent field names, toolsets or panels.** This package has no parser of its own
and cannot tell you whether a name is real; the platform can. Copy the shape from
`agent init`'s scaffold or from `agent templates`, and let `agent validate` rule on it.

**`defaultModel` has to be a name the chosen provider serves.** `agent models <provider>`
lists them, cheapest first, with `no tools` marked. A model without tool calling cannot
use its own terminal, which is most of what an agent here is for. Providers:
`requesty`, `openrouter`, `anthropic`, `openai`, `ollama-cloud`.

## Commands

| Command | What it does |
| --- | --- |
| `agent init [dir]` | Scaffold a project. `--template <slug>` starts from a worked example instead, as one document. |
| `agent build [dir]` | Compile to `.agentspaces/agent.md`. `--emit` prints it. |
| `agent validate [dir]` | The platform reads it and reports what it would build. |
| `agent explain [dir]` | The same at length: wizard, environment keys, toolsets, soul. |
| `agent run [dir]` | Run it here in the image the cloud deploys. `--test` runs `test.yaml`, `--down` removes the container, `--image <ref>` overrides the pinned image. |
| `agent templates` | The platform's examples, each adding one part of the format to the last. |
| `agent runtimes` | Which container image each `brain:` resolves to, and what was verified when. |
| `agent models <provider>` | A provider's catalogue. `--free`, `--tools`, `--key <k>`. |
| `agent search [query]` | The published catalogue. `--verified`, `--brain <b>`, `--category <c>`, `--all`. |
| `agent doctor` | Node, reachability, and whether the project here is valid. |

`--json` on any of them for machine-readable output, which is the form to parse rather
than scraping the text. `--api <url>` points at another backend. Exit codes are `0`,
`1` for a failure and `2` for a command line that did not parse.

Nothing here needs an account. Deploying, logs, chat, start and stop are not in this
release, because they provision or talk to a running server. Do not offer to run them.

## Running it locally

```bash
agent run --test     # places the project, runs setup.sh and test.yaml
docker exec -it agentkit-<id> hermes    # openclaw for an openclaw agent
agent run --down
```

The container is named `agentkit-<id>` from `agent.yaml`. It is started idle and reached
by `docker exec`, so it occupies no port. Everything inside runs as the user the agent
runs as, which is how a file the agent cannot read gets caught here rather than in
production. One difference worth repeating to whoever asked: locally the runtime keeps
its own default config, while the cloud renders a hardened one on top, so approvals, the
website blocklist and the toolsets are not the same there.

## When something fails

- `validate` names a **section** of the built document rather than a file, because it is
  reading the compiled form. Map it back yourself: Runtime is `config.yaml`, Environment
  is `.env`, Config is `fields.yaml`, Onboarding is `onboarding.yaml`, Soul is `soul.md`,
  Files is `files/`.
- `unanswered` after `agent run` lists placeholders nobody filled. They are left standing
  in the files rather than blanked. Answer them in `.env.local`: `TEAM_NAME=Platform`
  answers `{{teamName}}`, because an environment name is how a field name is spelled there.
- `Could not run docker` means Docker is not installed or not started. Nothing else in
  this package needs it.
- An unreadable file inside the container means ownership. Report it rather than working
  around it with `chmod 777`.
- Exit 2 is a command line problem, so reread the flags before changing the project.

## What to do without being asked

Read the scaffold's comments before writing into it, run `agent validate` after any edit
you make to a project, and say which file you changed. Do not reformat files you were
not asked to touch: the comments in the scaffold are the documentation for the format.
