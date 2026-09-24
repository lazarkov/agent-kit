/**
 * The shapes the platform actually answers with, transcribed from live responses
 * rather than from its source: this package talks to a deployed API over HTTP, and
 * what matters is the wire, not the class that produced it. Every field is optional
 * where an older or newer backend could omit it.
 */

export interface ConfigField {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  sensitive?: boolean;
  enumValues?: string[];
  placeholder?: string;
  help?: string;
  default?: unknown;
}

export interface OnboardingStep {
  id: string;
  panel: string;
  label?: string;
  description?: string;
}

export interface Toolset {
  key: string;
  label?: string;
  tools?: string;
  enabled?: boolean;
}

export interface ScheduleJob {
  name?: string;
  /** The runtime's own grammar: `30m`, `every 2h`, `1d`, or a raw cron expression. */
  every?: string;
  prompt?: string;
  /** A script under the profile's `scripts/`, run instead of prompting the model. */
  script?: string;
  /** With a script, skip the model entirely and deliver its stdout verbatim. */
  noAgent?: boolean;
  /** `origin`, `local`, `telegram`, or `platform:chat_id`. Defaults to telegram. */
  deliver?: string;
}

/** The answer from `POST /agents/blueprints/validate`: a preview, not the document. */
export interface BlueprintPreview {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  kind?: string;
  origin?: { url?: string; note?: string } | null;
  steps?: OnboardingStep[];
  config?: ConfigField[];
  /** Names only. Values are collected at deploy time, never read from here. */
  envKeys?: string[];
  /** Paths only: the platform deliberately does not echo file bodies back. */
  files?: string[];
  setup?: string[];
  diagnostics?: string[];
  soulLines?: number;
  soul?: string;
  runtime?: Record<string, unknown>;
  brain?: string;
  schedule?: ScheduleJob[];
  toolsets?: Toolset[];
}

/** `GET /agents/blueprints/examples`: the platform's own examples, with source. */
export interface BlueprintExample {
  slug: string;
  name: string;
  description: string;
  kind?: string;
  sections?: string[];
  source: string;
}

/** `GET /agents/runtimes`: which container images a `brain:` resolves to. */
export interface RuntimeInfo {
  brain: string;
  image: string;
  repo?: string;
  verified?: {
    release?: string;
    commit?: string;
    image?: string;
    digest?: string;
    checkedAt?: string;
    note?: string;
  }[];
  upstream?: {
    release?: string;
    publishedAt?: string;
    url?: string;
    readAt?: string;
    verified?: boolean;
  } | null;
}

/** `POST /agents/llm-models`: a provider's catalogue, priced per token. */
export interface LlmModel {
  id: string;
  label?: string;
  contextLength?: number;
  promptPrice?: number | null;
  free?: boolean;
  toolCapable?: boolean;
  createdAt?: number;
}

export interface LlmModelsResponse {
  provider: string;
  models: LlmModel[];
}

/** `GET /agents/types`: the published catalogue. */
export interface AgentType {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  available?: boolean;
  verified?: boolean;
  brain?: string;
  hasTest?: boolean;
  requiresConfig?: boolean;
  layers?: unknown[];
  origin?: { url?: string; note?: string } | null;
}
