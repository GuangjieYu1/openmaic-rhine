import { describe, expect, it } from 'vitest';

import { withProviderHeadersInit } from '@/lib/config/provider-headers';

// Test-only header name/value; never a real gateway session id.
const CONFIGURED_HEADERS = { 'x-opencode-session': 'test-session-value' };

describe('withProviderHeadersInit', () => {
  it('merges into a Headers instance without dropping SDK headers', () => {
    const init = { method: 'POST', headers: new Headers({ Authorization: 'Bearer test' }) };
    const out = withProviderHeadersInit(init, CONFIGURED_HEADERS);

    expect(new Headers(out.headers).get('x-opencode-session')).toBe('test-session-value');
    expect(new Headers(out.headers).get('Authorization')).toBe('Bearer test');
    expect(out.method).toBe('POST');
  });

  it('merges into plain-record headers', () => {
    const out = withProviderHeadersInit(
      { headers: { Authorization: 'Bearer test' } },
      CONFIGURED_HEADERS,
    );

    expect(new Headers(out.headers).get('x-opencode-session')).toBe('test-session-value');
    expect(new Headers(out.headers).get('Authorization')).toBe('Bearer test');
  });

  it('merges into tuple-array headers', () => {
    const out = withProviderHeadersInit(
      { headers: [['Authorization', 'Bearer test']] },
      CONFIGURED_HEADERS,
    );

    expect(new Headers(out.headers).get('x-opencode-session')).toBe('test-session-value');
    expect(new Headers(out.headers).get('Authorization')).toBe('Bearer test');
  });

  it('adds headers when the init carries none', () => {
    const out = withProviderHeadersInit({ method: 'POST' } as RequestInit, CONFIGURED_HEADERS);

    expect(new Headers(out.headers).get('x-opencode-session')).toBe('test-session-value');
    expect(out.method).toBe('POST');
  });

  it('adds headers when the init itself is absent', () => {
    const out = withProviderHeadersInit(undefined as RequestInit | undefined, CONFIGURED_HEADERS);

    expect(new Headers(out?.headers).get('x-opencode-session')).toBe('test-session-value');
  });

  it('lets a configured header win over an SDK-set header of the same name', () => {
    const out = withProviderHeadersInit(
      { headers: new Headers({ 'x-opencode-session': 'sdk-default' }) },
      CONFIGURED_HEADERS,
    );

    expect(new Headers(out.headers).get('x-opencode-session')).toBe('test-session-value');
  });

  it('returns the init untouched when nothing is configured', () => {
    const init = { headers: { Authorization: 'Bearer test' } };

    expect(withProviderHeadersInit(init, undefined)).toBe(init);
    expect(withProviderHeadersInit(init, {})).toBe(init);
  });
});
