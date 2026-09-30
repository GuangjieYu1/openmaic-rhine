/**
 * Xiaomi MiMo TTS adapter.
 *
 * MiMo is the one provider whose audio does not arrive as an audio response
 * body: TTS rides chat/completions (the text in an `assistant`-role message,
 * the voice in an `audio` parameter) and the WAV comes back base64-encoded
 * INSIDE the JSON body. These tests pin that contract — request shape, base64
 * decode, the vendor error envelope, and the "200 with no audio" failure —
 * because the shared raw-body validator (`validateTTSAudioResponse`) can never
 * cover this provider.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_MODELS, DEFAULT_TTS_VOICES, TTS_PROVIDERS } from '@/lib/audio/constants';

const mockFetch = vi.hoisted(() => vi.fn() as Mock);
// The provider adapters issue requests through undici's fetch (with a pinned
// dispatcher), not the Next-patched global, so the double lives here.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const TOKEN_PLAN_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';

/** A minimal RIFF/WAVE header, in the shape the endpoint returns. */
function wavBytes(): Uint8Array {
  const data = new Uint8Array(16);
  data.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
  data.set([0x57, 0x41, 0x56, 0x45], 8); // 'WAVE'
  return data;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Success envelope: the audio rides inside choices[0].message.audio. */
function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: { get: () => 'application/json' },
  };
}

function audioEnvelope(data: unknown) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: '',
          audio: { data, id: 'audio-1', expires_at: 1_700_000_000, transcript: '' },
        },
      },
    ],
  };
}

/** Verified vendor error shape: {"error":{"code","message","param","type"}}. */
function errorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
    statusText: 'Bad Request',
    headers: { get: () => 'application/json' },
  };
}

describe('MiMo TTS', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('posts chat/completions with the text in an assistant message and the voice in audio', async () => {
    const bytes = wavBytes();
    mockFetch.mockResolvedValueOnce(okResponse(audioEnvelope(b64(bytes))));

    await generateTTS({ providerId: 'mimo-tts', apiKey: 'tp-secret', voice: '冰糖' }, '你好，世界');

    const [url, init] = mockFetch.mock.calls[0];
    // The base URL already carries /v1; only /chat/completions is appended.
    expect(url).toBe(`${TOKEN_PLAN_BASE_URL}/chat/completions`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tp-secret');
    expect(init.headers['Content-Type']).toBe('application/json; charset=utf-8');

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [{ role: 'assistant', content: '你好，世界' }],
      audio: { format: 'wav', voice: '冰糖' },
    });
    // The endpoint takes no rate/pace parameter, so speed is deliberately not
    // sent (an unverified field answers 400 "Param Incorrect").
    expect(body).not.toHaveProperty('speed');
    expect(body.messages).toHaveLength(1);
  });

  it('decodes the base64 WAV out of the JSON body into the shared result shape', async () => {
    const bytes = wavBytes();
    mockFetch.mockResolvedValueOnce(okResponse(audioEnvelope(b64(bytes))));

    const result = await generateTTS(
      { providerId: 'mimo-tts', apiKey: 'tp-secret', voice: '冰糖' },
      'hi',
    );

    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.audio)).toEqual(Array.from(bytes));
    expect(result.format).toBe('wav');
  });

  it('honours an explicit base URL (trailing slash) and model', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(audioEnvelope(b64(wavBytes()))));

    await generateTTS(
      {
        providerId: 'mimo-tts',
        apiKey: 'tp-secret',
        baseUrl: 'https://api.xiaomimimo.com/v1/',
        voice: 'Mia',
        modelId: 'mimo-v2.5-tts',
      },
      'hello',
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    expect(JSON.parse(init.body).audio.voice).toBe('Mia');
  });

  it('surfaces the vendor error message and the offending param', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(400, {
        error: { code: '400', message: 'Param Incorrect', param: 'audio.voice', type: '' },
      }),
    );

    await expect(
      generateTTS({ providerId: 'mimo-tts', apiKey: 'tp-secret', voice: 'nope' }, 'hi'),
    ).rejects.toThrow(/MiMo TTS API error: Param Incorrect \(param: audio\.voice\)/);
  });

  it('keeps the raw body when the error is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => 'upstream unavailable',
      statusText: 'Bad Gateway',
      headers: { get: () => 'text/plain' },
    });

    await expect(
      generateTTS({ providerId: 'mimo-tts', apiKey: 'tp-secret', voice: '冰糖' }, 'hi'),
    ).rejects.toThrow(/MiMo TTS API error \(HTTP 502\): upstream unavailable/);
  });

  it('maps a 429 to the shared rate-limit error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'slow down',
      statusText: 'Too Many Requests',
      headers: { get: (name: string) => (name === 'retry-after' ? '2' : null) },
    });

    await expect(
      generateTTS({ providerId: 'mimo-tts', apiKey: 'tp-secret', voice: '冰糖' }, 'hi'),
    ).rejects.toThrow(/MiMo TTS rate limit exceeded/);
  });

  it.each([
    ['an empty data string', audioEnvelope('')],
    ['a whitespace-only data string', audioEnvelope('   ')],
    ['a missing audio object', { choices: [{ message: { role: 'assistant', content: '' } }] }],
    ['no choices at all', {}],
  ])('throws instead of returning silence for %s', async (_label, envelope) => {
    mockFetch.mockResolvedValueOnce(okResponse(envelope));

    await expect(
      generateTTS({ providerId: 'mimo-tts', apiKey: 'tp-secret', voice: '冰糖' }, 'hi'),
    ).rejects.toThrow(/MiMo TTS error: no audio data in response/);
  });

  it('rejects a non-base64 payload that would decode to zero bytes', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(audioEnvelope('!!!!')));

    await expect(
      generateTTS({ providerId: 'mimo-tts', apiKey: 'tp-secret', voice: '冰糖' }, 'hi'),
    ).rejects.toThrow(/MiMo TTS error: audio data decoded to 0 bytes/);
  });

  it('reports a non-JSON 200 body (wrong base URL) as an invalid response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
      headers: { get: () => 'text/html' },
    });

    await expect(
      generateTTS({ providerId: 'mimo-tts', apiKey: 'tp-secret', voice: '冰糖' }, 'hi'),
    ).rejects.toThrow(/MiMo TTS returned a non-JSON response body/);
  });

  it('rejects a missing API key before making a request', async () => {
    // The generic generateTTS guard (requiresApiKey && !apiKey) fires first.
    await expect(
      generateTTS({ providerId: 'mimo-tts', apiKey: '', voice: '冰糖' }, 'hi'),
    ).rejects.toThrow(/API key required for TTS provider: mimo-tts/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('MiMo TTS registry entry', () => {
  it('defaults to the token-plan gateway, the preset-voice model and 冰糖', () => {
    const provider = TTS_PROVIDERS['mimo-tts'];
    expect(provider.defaultBaseUrl).toBe(TOKEN_PLAN_BASE_URL);
    expect(provider.defaultModelId).toBe('mimo-v2.5-tts');
    expect(provider.supportedFormats).toEqual(['wav']);
    expect(provider.requiresApiKey).toBe(true);
    expect(DEFAULT_TTS_MODELS['mimo-tts']).toBe('mimo-v2.5-tts');
    expect(DEFAULT_TTS_VOICES['mimo-tts']).toBe('冰糖');
    expect(provider.voices.map((voice) => voice.id)).toContain('冰糖');
  });
});
