/**
 * Operator-side activation of the MiMo TTS provider.
 *
 * tests/audio/mimo-tts.test.ts proves the wire contract; this one proves the
 * deployment story — the operator's `TTS_MIMO_API_KEY` alone lights the provider
 * up and its base URL falls back to the token-plan gateway the registry ships,
 * so no other setting is required to go from "0 TTS" to a working narrator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs — only intercept server-providers.yml so a host-machine YAML config
// can never leak into these assertions (same pattern as provider-config.test.ts).
let yamlOverride: string | null = null;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const isYaml = (p: unknown) => typeof p === 'string' && p.endsWith('server-providers.yml');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: string) => (isYaml(p) ? yamlOverride !== null : actual.existsSync(p)),
      readFileSync: (p: string, ...args: unknown[]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isYaml(p) ? (yamlOverride ?? '') : (actual.readFileSync as any)(p, ...args),
    },
    existsSync: (p: string) => (isYaml(p) ? yamlOverride !== null : actual.existsSync(p)),
    readFileSync: (p: string, ...args: unknown[]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      isYaml(p) ? (yamlOverride ?? '') : (actual.readFileSync as any)(p, ...args),
  };
});

/** Never let a key exported on the host machine decide the outcome. */
function clearMimoEnv() {
  for (const suffix of ['API_KEY', 'BASE_URL', 'MODELS', 'ENABLED']) {
    delete process.env['TTS_MIMO_' + suffix];
  }
}

describe('MiMo TTS server configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearMimoEnv();
    yamlOverride = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('activates mimo-tts from TTS_MIMO_API_KEY alone, defaulting to the token-plan gateway', async () => {
    vi.stubEnv('TTS_MIMO_API_KEY', 'tp-secret');
    const {
      enabledServerTTSProviderIds,
      isServerConfiguredProvider,
      resolveTTSApiKey,
      resolveTTSBaseUrl,
    } = await import('@/lib/server/provider-config');

    expect(isServerConfiguredProvider('tts', 'mimo-tts')).toBe(true);
    expect(enabledServerTTSProviderIds()).toContain('mimo-tts');
    expect(resolveTTSApiKey('mimo-tts')).toBe('tp-secret');
    // No TTS_MIMO_BASE_URL needed: the registry default (token-plan CN) applies.
    expect(resolveTTSBaseUrl('mimo-tts')).toBe('https://token-plan-cn.xiaomimimo.com/v1');
  });

  it('honours the TTS_MIMO_BASE_URL and TTS_MIMO_MODELS overrides', async () => {
    vi.stubEnv('TTS_MIMO_API_KEY', 'tp-secret');
    vi.stubEnv('TTS_MIMO_BASE_URL', 'https://api.xiaomimimo.com/v1');
    vi.stubEnv('TTS_MIMO_MODELS', 'mimo-v2.5-tts');
    const { resolveTTSBaseUrl, resolveTTSModel } = await import('@/lib/server/provider-config');

    expect(resolveTTSBaseUrl('mimo-tts')).toBe('https://api.xiaomimimo.com/v1');
    // An operator-pinned model list is authoritative (first entry wins).
    expect(resolveTTSModel('mimo-tts', 'some-other-model')).toBe('mimo-v2.5-tts');
  });

  it('stays unconfigured without the env key, leaving client BYOK untouched', async () => {
    const { enabledServerTTSProviderIds, isServerConfiguredProvider, resolveTTSApiKey } =
      await import('@/lib/server/provider-config');

    expect(isServerConfiguredProvider('tts', 'mimo-tts')).toBe(false);
    expect(enabledServerTTSProviderIds()).not.toContain('mimo-tts');
    expect(resolveTTSApiKey('mimo-tts')).toBe('');
    expect(resolveTTSApiKey('mimo-tts', 'sk-client')).toBe('sk-client');
  });

  it('reports TTS_MIMO_ENABLED=false as a force-disable', async () => {
    vi.stubEnv('TTS_MIMO_API_KEY', 'tp-secret');
    vi.stubEnv('TTS_MIMO_ENABLED', 'false');
    const { enabledServerTTSProviderIds, getServerTTSProviders } =
      await import('@/lib/server/provider-config');

    expect(getServerTTSProviders()['mimo-tts']).toMatchObject({ disabled: true });
    expect(enabledServerTTSProviderIds()).not.toContain('mimo-tts');
  });
});
