import { describe, expect, it } from 'vitest';

import { ApiClient, unwrap } from '../src/api.js';
import { CliError } from '../src/errors.js';

describe('ApiClient', () => {
  it('passes the platform’s own message through, and its details as the hint', async () => {
    const client = new ApiClient(
      'https://api.test/api',
      async () =>
        new Response(
          JSON.stringify({
            code: 'BLUEPRINT_INVALID',
            message: "your blueprint: unknown section '## Prompt' — did you mean '## Soul'?",
            details: 'Sections are fixed; see the format reference.',
          }),
          { status: 400 },
        ),
    );

    // Transcribed from a live 400, em dash and all: this is the platform's wording, so
    // tidying it here would only make the fixture stop matching what users will see.
    // Rewording it would lose the did-you-mean, which is the useful half.
    await expect(client.post('/x', {})).rejects.toMatchObject({
      message: expect.stringContaining("did you mean '## Soul'"),
      code: 'BLUEPRINT_INVALID',
      hint: 'Sections are fixed; see the format reference.',
      exitCode: 1,
    });
  });

  it('names the address when it cannot be reached', async () => {
    const client = new ApiClient('http://localhost:3001/api', async () => {
      throw new Error('fetch failed');
    });

    await expect(client.get('/agents/runtimes')).rejects.toThrow(
      /Could not reach http:\/\/localhost:3001\/api/,
    );
  });

  it('does not mistake an HTML error page for a payload', async () => {
    const client = new ApiClient(
      'https://api.test/api',
      async () => new Response('<html>502</html>', { status: 200 }),
    );
    await expect(client.get('/agents/runtimes')).rejects.toBeInstanceOf(CliError);
  });

  it('trims a trailing slash so --api with one still builds valid urls', async () => {
    let seen = '';
    const client = new ApiClient('https://api.test/api/', async (url) => {
      seen = url;
      return new Response('{}', { status: 200 });
    });
    await client.get('/agents/runtimes');
    expect(seen).toBe('https://api.test/api/agents/runtimes');
  });
});

describe('unwrap', () => {
  it('takes the envelope off the routes that have one and leaves the rest', () => {
    expect(unwrap<number[]>({ data: [1, 2] })).toEqual([1, 2]);
    // llm-models answers { provider, models } with no envelope at all.
    expect(unwrap<{ provider: string }>({ provider: 'openrouter' })).toEqual({
      provider: 'openrouter',
    });
  });
});
