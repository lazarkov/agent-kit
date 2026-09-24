import { CliError } from './errors.js';

/**
 * The public API, which is where the default belongs: every call this release makes
 * is one an anonymous visitor may make, so the package is useful with no
 * configuration at all. `--api` or `AGENTSPACES_API` points it at a local backend.
 */
export const DEFAULT_API = 'https://eu.agentspaces.app/api';

/** What the platform sends back when it refuses: `{ code, message, details? }`. */
interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * A client thin enough to be worth reading.
 *
 * No retries: every route used here is a read or a validation, and a retry on a
 * throttled route would spend the next minute's allowance as well. The platform
 * throttles `validate` at 120/min, `examples` at 60/min and `llm-models` at 20/min,
 * which no interactive use of this tool can reach and a loop would.
 */
export class ApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string = DEFAULT_API, fetchImpl?: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      // A DNS failure and a backend that is not running look the same from here, and
      // naming the address is what tells the two apart for the person reading it.
      throw new CliError(`Could not reach ${this.baseUrl}: ${(err as Error).message}`, {
        hint: 'Check the address, or pass --api to point somewhere else.',
      });
    }

    const text = await response.text();
    const parsed = parseJson(text);

    if (!response.ok) {
      const error = (parsed ?? {}) as ApiErrorBody;
      // The platform's own message is the whole value of this path: the blueprint
      // parser names the section and the likely fix, and reworded it would be worse.
      const message = error.message ?? `${response.status} from ${url}`;
      throw new CliError(message, {
        code: error.code ?? null,
        hint: error.details ?? null,
      });
    }

    if (parsed === null) {
      throw new CliError(`${url} answered ${response.status} with something that is not JSON.`);
    }

    return parsed as T;
  }
}

function parseJson(text: string): unknown | null {
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Most routes answer `{ data: … }` and a couple answer the object directly.
 * Unwrapping in one place keeps that asymmetry out of every command.
 */
export function unwrap<T>(body: unknown): T {
  if (body !== null && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}
