import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server-managed provider headers and out-of-catalog protocol resolution.
 *
 * Only the YAML file is faked; provider-config, resolve-model and getModel are
 * real, so the assertions observe what the transport actually issues. Header
 * names/values here are test-only — never a real gateway key or session id.
 */
const state = vi.hoisted(() => ({ yaml: null as string | null }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const isYaml = (p: unknown) => typeof p === 'string' && p.endsWith('server-providers.yml');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: string) => (isYaml(p) ? state.yaml !== null : actual.existsSync(p)),
      readFileSync: (p: string, ...args: unknown[]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isYaml(p) ? (state.yaml ?? '') : (actual.readFileSync as any)(p, ...args),
    },
    existsSync: (p: string) => (isYaml(p) ? state.yaml !== null : actual.existsSync(p)),
    readFileSync: (p: string, ...args: unknown[]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      isYaml(p) ? (state.yaml ?? '') : (actual.readFileSync as any)(p, ...args),
  };
});

const openAiMock = vi.hoisted(() => ({
  chat: vi.fn((modelId: string) => ({ endpoint: 'chat', modelId })),
  responses: vi.fn((modelId: string) => ({ endpoint: 'responses', modelId })),
  createOpenAI: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({ createOpenAI: openAiMock.createOpenAI }));

/** A YAML entry for an id absent from the built-in catalog, with headers. */
const OPENCODE_GO_YAML = `
providers:
  opencode-go:
    type: openai
    apiKey: test-gateway-key
    baseUrl: https://gateway.test/v1
    models: [deepseek-v4.1-flash]
    headers:
      x-opencode-session: test-session-value
`;

/** Invoke the installed transport and return the headers global fetch received. */
async function captureRequestHeaders(
  options: { fetch?: typeof fetch } | undefined,
  init: RequestInit,
): Promise<Headers> {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  try {
    globalThis.fetch = fetchMock as typeof fetch;
    await options?.fetch?.('https://gateway.test/v1/chat/completions', init);
    const sent = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    return new Headers(sent.headers);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('server provider headers (YAML)', () => {
  beforeEach(() => {
    vi.resetModules();
    state.yaml = null;
  });

  it('resolves the headers of a YAML provider entry', async () => {
    state.yaml = OPENCODE_GO_YAML;
    const { resolveProviderHeaders } = await import('@/lib/server/provider-config');

    expect(resolveProviderHeaders('opencode-go')).toEqual({
      'x-opencode-session': 'test-session-value',
    });
  });

  it('returns undefined when the entry declares no headers', async () => {
    state.yaml = 'providers:\n  opencode-go:\n    apiKey: test-gateway-key\n';
    const { resolveProviderHeaders } = await import('@/lib/server/provider-config');

    expect(resolveProviderHeaders('opencode-go')).toBeUndefined();
  });

  it('never exposes headers on the client-facing provider listing', async () => {
    state.yaml = OPENCODE_GO_YAML;
    const { getServerProviders } = await import('@/lib/server/provider-config');
    const listing = getServerProviders();

    expect(listing['opencode-go']).toEqual({ models: ['deepseek-v4.1-flash'] });
    expect(JSON.stringify(listing)).not.toContain('test-session-value');
  });
});

describe('out-of-catalog provider protocol resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    state.yaml = null;
  });

  it('defaults to the OpenAI protocol when the entry has a baseUrl but no type', async () => {
    state.yaml =
      'providers:\n  opencode-go:\n    apiKey: test-gateway-key\n    baseUrl: https://gateway.test/v1\n';
    const { resolveServerProviderType } = await import('@/lib/server/provider-config');

    expect(resolveServerProviderType('opencode-go')).toBe('openai');
  });

  it('honours an explicit type', async () => {
    state.yaml =
      'providers:\n  opencode-go:\n    type: google\n    apiKey: test-gateway-key\n    baseUrl: https://gateway.test/v1\n';
    const { resolveServerProviderType } = await import('@/lib/server/provider-config');

    expect(resolveServerProviderType('opencode-go')).toBe('google');
  });

  it('throws a message naming the provider for an unsupported type', async () => {
    state.yaml =
      'providers:\n  opencode-go:\n    type: not-a-protocol\n    apiKey: test-gateway-key\n    baseUrl: https://gateway.test/v1\n';
    const { resolveServerProviderType } = await import('@/lib/server/provider-config');

    expect(() => resolveServerProviderType('opencode-go')).toThrow(/opencode-go/);
    expect(() => resolveServerProviderType('opencode-go')).toThrow(/not-a-protocol/);
  });

  it('stays unresolved without a baseUrl (a typo must not become a provider)', async () => {
    state.yaml = 'providers:\n  opencode-go:\n    apiKey: test-gateway-key\n';
    const { resolveServerProviderType } = await import('@/lib/server/provider-config');

    expect(resolveServerProviderType('opencode-go')).toBeUndefined();
  });

  it('stays unresolved without a baseUrl even when a type is declared', async () => {
    state.yaml = 'providers:\n  opencode-go:\n    type: openai\n    apiKey: test-gateway-key\n';
    const { resolveServerProviderType } = await import('@/lib/server/provider-config');

    expect(resolveServerProviderType('opencode-go')).toBeUndefined();
  });

  it('returns undefined for an id with no server entry', async () => {
    const { resolveServerProviderType } = await import('@/lib/server/provider-config');

    expect(resolveServerProviderType('opencode-go')).toBeUndefined();
  });
});

describe('out-of-catalog gateway requests', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    state.yaml = null;
    delete process.env.MODEL_ROUTES;
    delete process.env.DEFAULT_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODELS;
    delete process.env.OPENAI_COMPAT_USE_STREAMING_CHAT;
    openAiMock.chat.mockClear();
    openAiMock.responses.mockClear();
    openAiMock.createOpenAI.mockReset();
    openAiMock.createOpenAI.mockReturnValue({
      chat: openAiMock.chat,
      responses: openAiMock.responses,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves the YAML entry to an OpenAI-compatible provider', async () => {
    state.yaml = OPENCODE_GO_YAML;
    const { resolveModel } = await import('@/lib/server/resolve-model');
    const resolved = await resolveModel({ modelString: 'opencode-go:deepseek-v4.1-flash' });

    expect(resolved.providerId).toBe('opencode-go');
    expect(resolved.baseUrl).toBe('https://gateway.test/v1');
    const options = openAiMock.createOpenAI.mock.calls.at(-1)?.[0] as
      | { apiKey?: string; baseURL?: string }
      | undefined;
    expect(options?.apiKey).toBe('test-gateway-key');
    expect(options?.baseURL).toBe('https://gateway.test/v1');
  });

  it('carries the configured header on a plain-record init.headers', async () => {
    state.yaml = OPENCODE_GO_YAML;
    const { resolveModel } = await import('@/lib/server/resolve-model');
    await resolveModel({ modelString: 'opencode-go:deepseek-v4.1-flash' });
    const options = openAiMock.createOpenAI.mock.calls.at(-1)?.[0] as
      | { fetch?: typeof fetch }
      | undefined;

    const headers = await captureRequestHeaders(options, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-gateway-key' },
      body: JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [] }),
    });

    expect(headers.get('x-opencode-session')).toBe('test-session-value');
    expect(headers.get('Authorization')).toBe('Bearer test-gateway-key');
  });

  it('carries the configured header on a Headers-instance init.headers', async () => {
    state.yaml = OPENCODE_GO_YAML;
    const { resolveModel } = await import('@/lib/server/resolve-model');
    await resolveModel({ modelString: 'opencode-go:deepseek-v4.1-flash' });
    const options = openAiMock.createOpenAI.mock.calls.at(-1)?.[0] as
      | { fetch?: typeof fetch }
      | undefined;

    const headers = await captureRequestHeaders(options, {
      method: 'POST',
      headers: new Headers({ Authorization: 'Bearer test-gateway-key' }),
      body: JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [] }),
    });

    expect(headers.get('x-opencode-session')).toBe('test-session-value');
    expect(headers.get('Authorization')).toBe('Bearer test-gateway-key');
  });

  it('also applies configured headers on the native OpenAI path', async () => {
    state.yaml =
      'providers:\n  openai:\n    apiKey: test-openai-key\n    headers:\n      x-opencode-session: test-session-value\n';
    const { resolveModel } = await import('@/lib/server/resolve-model');
    await resolveModel({ modelString: 'openai:gpt-5.6-sol' });
    // Responses dialect proves this really is the native (non-compat) branch.
    expect(openAiMock.responses).toHaveBeenCalledWith('gpt-5.6-sol');
    expect(openAiMock.chat).not.toHaveBeenCalled();
    const options = openAiMock.createOpenAI.mock.calls.at(-1)?.[0] as
      | { fetch?: typeof fetch }
      | undefined;

    const headers = await captureRequestHeaders(options, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-sol' }),
    });

    expect(headers.get('x-opencode-session')).toBe('test-session-value');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('still throws for an out-of-catalog id with no baseUrl', async () => {
    state.yaml = 'providers:\n  opencode-go:\n    apiKey: test-gateway-key\n';
    const { resolveModel } = await import('@/lib/server/resolve-model');

    await expect(resolveModel({ modelString: 'opencode-go:deepseek-v4.1-flash' })).rejects.toThrow(
      'Unknown provider: opencode-go',
    );
  });

  it('still throws when a type is declared but no baseUrl is set', async () => {
    state.yaml = 'providers:\n  opencode-go:\n    type: openai\n    apiKey: test-gateway-key\n';
    const { resolveModel } = await import('@/lib/server/resolve-model');

    await expect(resolveModel({ modelString: 'opencode-go:deepseek-v4.1-flash' })).rejects.toThrow(
      'Unknown provider: opencode-go',
    );
  });

  it('fails naming the provider when the YAML type is unsupported', async () => {
    state.yaml =
      'providers:\n  opencode-go:\n    type: not-a-protocol\n    apiKey: test-gateway-key\n    baseUrl: https://gateway.test/v1\n';
    const { resolveModel } = await import('@/lib/server/resolve-model');

    await expect(resolveModel({ modelString: 'opencode-go:deepseek-v4.1-flash' })).rejects.toThrow(
      /opencode-go/,
    );
    await expect(resolveModel({ modelString: 'opencode-go:deepseek-v4.1-flash' })).rejects.toThrow(
      /not-a-protocol/,
    );
  });
});
