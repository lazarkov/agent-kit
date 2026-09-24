---
id: my-agent
version: 0.1.0
name: My Agent
description: One sentence on what this agent does, in the words you would use to a colleague.
category: productivity
tags: [Starter]
---

The smallest document that deploys: five required frontmatter fields, a model, a
wizard short enough to be no wizard at all, and a soul. Everything else in the
format is optional — run `agent templates` to see what the other examples add.

Prose outside the `##` sections is yours. It is not sent to the agent; only the
sections below are.

## Config

The three LLM keys, which the `llm` panel collects on its own — so this document
needs no form of its own. Add a field here and you also need a `panel: config`
step under Onboarding; validation will say so if you forget.

```yaml
- key: llmProvider
  label: LLM Provider
  type: enum
  required: true
  enumValues: [openrouter, anthropic, openai, ollama-cloud]
- key: llmApiKey
  label: LLM API Key
  type: string
  required: true
  sensitive: true
- key: llmModel
  label: LLM Model
  type: string
  required: false
  placeholder: anthropic/claude-sonnet-4.6
  help: Leave empty to use the model named under Runtime.
```

## Onboarding

```yaml
- id: llm
  panel: llm
  label: LLM Provider
  description: Bring your own key
- id: create-agent
  panel: create-agent
  label: Create Agent
  description: Deploy it to a server
- id: start
  panel: start
  label: Go Live
  description: Start working
```

## Environment

```yaml
LLM_PROVIDER: '{{llmProvider | "openrouter"}}'
LLM_MODEL: '{{llmModel | defaultModel}}'
# The variable name is templated too, so the key lands under whichever name the
# chosen provider actually reads.
'{{llmKeyVar}}': '{{llmApiKey}}'
```

## Runtime

```yaml
defaultModel: anthropic/claude-sonnet-4.6
# Drop `toolsets` entirely to get every core tool. Listed here to keep this agent
# to what it needs: a terminal, files, and memory across conversations.
toolsets:
  - terminal
  - file
  - memory
```

## Soul

# Soul

You are a careful assistant with your own container and your own files. You do
the work rather than describe it.

## Behavior
- Keep durable notes as Markdown files under {{home}}/notes.
- Name files by subject, lower case with dashes.
- Before answering a question about past work, search those files.

## Available Tools
You have a terminal in your own container. There is no API for your notes — you
read and write them with ordinary shell commands:

```
mkdir -p {{home}}/notes
ls {{home}}/notes
grep -ril "invoice" {{home}}/notes
```

## Hard Rules
- Never answer from memory when a file would settle it.
- Never reveal credentials or API keys.
