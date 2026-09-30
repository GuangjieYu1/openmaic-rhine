/**
 * The REINLAB export envelope, pinned without a database.
 *
 * These are the decisions a client is being written against — which origins may
 * read a response, whether a token is accepted, which owner the surface reads,
 * and what the media manifest contains — so they are asserted as data here
 * rather than only through the routes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import type { DocumentSummary } from '@openmaic/storage';

import {
  buildReinlabMediaManifest,
  isReinlabCourseId,
  isReinlabExportTokenAccepted,
  isReinlabOriginAllowed,
  isReinlabOwnerId,
  reinlabCorsHeaders,
  reinlabExportToken,
  reinlabOwnerSource,
  resolveReinlabOwnerOverride,
  resolveReinlabOwnerOverrides,
  toReinlabCourseSummaries,
} from '@/lib/reinlab/export-server';
import { EXPECTED_MEDIA, makeCourseDocument } from './_course-fixture';

const ENV_KEYS = [
  'REINLAB_EXPORT_TOKEN',
  'REINLAB_OWNER_ID',
  'REINLAB_ALLOWED_ORIGINS',
  'PERSISTENCE_SHARED_OWNER_ID',
] as const;

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnv.clear();
});

function request(
  headers: Record<string, string> = {},
  url = 'http://localhost/api/reinlab/whoami',
) {
  return new NextRequest(url, { headers });
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

type OriginCase = [label: string, origin: string | null | undefined, allowed: boolean];

const ORIGIN_CASES: OriginCase[] = [
  ['the Capacitor WebView origin', 'capacitor://localhost', true],
  ['the Ionic predecessor origin', 'ionic://localhost', true],
  ['localhost over http', 'http://localhost', true],
  ['localhost over https with a port', 'https://localhost:3000', true],
  ['an IPv4 loopback with a port', 'http://127.0.0.1:8080', true],
  ['the loopback block', 'http://127.0.0.2', true],
  ['a 10/8 address', 'http://10.0.0.5', true],
  ['a 192.168/16 address with a port', 'http://192.168.1.20:5173', true],
  ['the low end of 172.16/12', 'https://172.16.0.1', true],
  ['the high end of 172.16/12', 'http://172.31.255.254', true],
  ['just past 172.16/12', 'http://172.32.0.1', false],
  ['just below 172.16/12', 'http://172.15.0.1', false],
  ['a 192.169 address', 'http://192.169.1.1', false],
  ['an 11/8 address', 'http://11.0.0.1', false],
  ['a public host', 'https://courses.example.com', false],
  // The bypass a substring test on the raw header would let through.
  ['a localhost-prefixed public host', 'http://localhost.evil.com', false],
  ['a private-IP-prefixed public host', 'http://192.168.1.1.evil.com', false],
  ['a loopback-prefixed public host', 'http://127.0.0.1.evil.com', false],
  ['an origin with a path', 'http://localhost.evil.com/http://localhost', false],
  ['a non-http scheme on a LAN address', 'ftp://192.168.1.1', false],
  ['the opaque null origin', 'null', false],
  ['an empty origin', '', false],
  ['a missing origin', undefined, false],
];

describe('isReinlabOriginAllowed', () => {
  it.each(ORIGIN_CASES)('decides %s', (_label, origin, allowed) => {
    expect(isReinlabOriginAllowed(origin)).toBe(allowed);
  });

  it('allows an origin the operator listed', () => {
    process.env.REINLAB_ALLOWED_ORIGINS = 'https://ipad.example.com, http://studio.local:1234';
    expect(isReinlabOriginAllowed('https://ipad.example.com')).toBe(true);
    expect(isReinlabOriginAllowed('http://studio.local:1234')).toBe(true);
  });

  it('matches a listed origin exactly, so it does not widen to another port or host', () => {
    process.env.REINLAB_ALLOWED_ORIGINS = 'https://ipad.example.com';
    expect(isReinlabOriginAllowed('https://ipad.example.com:8443')).toBe(false);
    expect(isReinlabOriginAllowed('https://ipad.example.com.evil.com')).toBe(false);
  });

  it('grants nothing for an unparseable allow-list entry', () => {
    process.env.REINLAB_ALLOWED_ORIGINS = 'not an origin, https://ipad.example.com';
    expect(isReinlabOriginAllowed('https://ipad.example.com')).toBe(true);
    expect(isReinlabOriginAllowed('not an origin')).toBe(false);
  });

  it('keeps two non-special-scheme origins distinct', () => {
    process.env.REINLAB_ALLOWED_ORIGINS = 'app://shell';
    expect(isReinlabOriginAllowed('app://shell')).toBe(true);
    expect(isReinlabOriginAllowed('app://other')).toBe(false);
  });
});

describe('reinlabCorsHeaders', () => {
  it('echoes an allowed origin and pins the rest of the grant', () => {
    const headers = reinlabCorsHeaders(request({ origin: 'capacitor://localhost' }));
    expect(headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type');
    expect(headers.get('access-control-max-age')).toBe('600');
    expect(headers.get('vary')).toBe('Origin');
  });

  it('never sends a wildcard, and omits the grant for a refused origin', () => {
    const headers = reinlabCorsHeaders(request({ origin: 'http://localhost.evil.com' }));
    expect(headers.get('access-control-allow-origin')).toBeNull();
    // The rest of the grant still rides the response; the browser simply
    // cannot read it.
    expect(headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(headers.get('vary')).toBe('Origin');
  });

  it('omits the grant for a caller that sent no Origin at all', () => {
    expect(reinlabCorsHeaders(request()).get('access-control-allow-origin')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Token gate
// ---------------------------------------------------------------------------

describe('isReinlabExportTokenAccepted', () => {
  it('allows every request while the token is unset', () => {
    expect(reinlabExportToken()).toBeNull();
    expect(isReinlabExportTokenAccepted(request())).toBe(true);
  });

  it('treats a blank token as unset', () => {
    process.env.REINLAB_EXPORT_TOKEN = '   ';
    expect(reinlabExportToken()).toBeNull();
    expect(isReinlabExportTokenAccepted(request())).toBe(true);
  });

  it('accepts the token as a Bearer header', () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';
    expect(isReinlabExportTokenAccepted(request({ authorization: 'Bearer s3cret' }))).toBe(true);
    expect(isReinlabExportTokenAccepted(request({ authorization: 'bearer s3cret' }))).toBe(true);
  });

  it('accepts the token as the query parameter', () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';
    const req = request({}, 'http://localhost/api/reinlab/courses?token=s3cret');
    expect(isReinlabExportTokenAccepted(req)).toBe(true);
  });

  it('accepts a valid query token when the header carries a wrong one', () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';
    const req = request(
      { authorization: 'Bearer wrong' },
      'http://localhost/api/reinlab/courses?token=s3cret',
    );
    expect(isReinlabExportTokenAccepted(req)).toBe(true);
  });

  const REFUSALS: Array<[string, Record<string, string>]> = [
    ['no credential at all', {}],
    ['a wrong token', { authorization: 'Bearer wrong' }],
    ['a wrong-length token', { authorization: 'Bearer s3cret-and-more' }],
    ['a shorter token', { authorization: 'Bearer s3' }],
    ['a scheme that is not Bearer', { authorization: 'Basic s3cret' }],
    ['a bare token with no scheme', { authorization: 's3cret' }],
  ];

  it.each(REFUSALS)('refuses %s', (_label, headers) => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';
    expect(isReinlabExportTokenAccepted(request(headers))).toBe(false);
  });

  it('does not throw when the presented token has a different length', () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';
    expect(() =>
      isReinlabExportTokenAccepted(request({ authorization: 'Bearer x' })),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Owner override
// ---------------------------------------------------------------------------

describe('resolveReinlabOwnerOverride', () => {
  it('is null while the override is unset or blank', () => {
    expect(resolveReinlabOwnerOverride()).toBeNull();
    process.env.REINLAB_OWNER_ID = '  ';
    expect(resolveReinlabOwnerOverride()).toBeNull();
  });

  it('returns a trimmed, valid owner id', () => {
    process.env.REINLAB_OWNER_ID = '  anon_1.2-3  ';
    expect(resolveReinlabOwnerOverride()).toBe('anon_1.2-3');
  });

  it.each([
    ['a value with a space', 'anon 1'],
    ['an anon: prefix without a UUID', 'anon:abc'],
    ['a value with a slash', 'a/b'],
    ['a value over the length cap', 'a'.repeat(129)],
  ])('refuses %s instead of reading the wrong library', (_label, value) => {
    process.env.REINLAB_OWNER_ID = value;
    expect(() => resolveReinlabOwnerOverride()).toThrow(
      /REINLAB_OWNER_ID entries must be an anonymous owner id/,
    );
  });

  it('accepts a value at exactly the length cap', () => {
    process.env.REINLAB_OWNER_ID = 'a'.repeat(128);
    expect(resolveReinlabOwnerOverride()).toHaveLength(128);
  });
});

// ---------------------------------------------------------------------------
// The owner ids that actually exist in this deployment
// ---------------------------------------------------------------------------

/**
 * Regression: the first version copied shared-owner.ts's pattern verbatim, which
 * excludes ':' — and every cookie-derived owner is 'anon:<uuid>'. The one
 * configuration this surface is documented to need therefore answered 500.
 * These values were read out of document_stages.owner_id on this machine.
 */
describe('isReinlabOwnerId', () => {
  it.each([
    'anon:390fedc3-ce3f-445b-b33b-fdee6f8a1562',
    'anon:91c07ee9-cbce-47cd-b91b-89b719b464be',
    'anon:57b9051f-5d23-43a8-87d6-60405f68b982',
  ])('accepts the real cookie-derived owner %s', (value) => {
    expect(isReinlabOwnerId(value)).toBe(true);
    process.env.REINLAB_OWNER_ID = value;
    expect(resolveReinlabOwnerOverride()).toBe(value);
  });

  it('accepts a shared-owner-style id, for deployments that set one', () => {
    expect(isReinlabOwnerId('reinlab')).toBe(true);
    expect(isReinlabOwnerId('anon_1.2-3')).toBe(true);
  });

  it('still refuses anything that is neither shape', () => {
    expect(isReinlabOwnerId('anon:not-a-uuid')).toBe(false);
    // A UUID v1/v3/5 must not pass the v4-shaped check either.
    expect(isReinlabOwnerId('anon:390fedc3-ce3f-145b-b33b-fdee6f8a1562')).toBe(false);
    expect(isReinlabOwnerId('')).toBe(false);
  });
});

/**
 * A per-browser owner means one person's library can be spread across several
 * `anon:` partitions — this machine holds three courses under three different
 * owners. `REINLAB_OWNER_ID` therefore takes a list.
 */
describe('resolveReinlabOwnerOverrides', () => {
  it('is null while the override is unset, blank, or only separators', () => {
    expect(resolveReinlabOwnerOverrides()).toBeNull();
    for (const value of ['  ', ',', ' , , ']) {
      process.env.REINLAB_OWNER_ID = value;
      expect(resolveReinlabOwnerOverrides()).toBeNull();
    }
  });

  it('parses a comma-separated list, trimming each entry', () => {
    process.env.REINLAB_OWNER_ID =
      ' anon:390fedc3-ce3f-445b-b33b-fdee6f8a1562 ,anon:91c07ee9-cbce-47cd-b91b-89b719b464be ';
    expect(resolveReinlabOwnerOverrides()).toEqual([
      'anon:390fedc3-ce3f-445b-b33b-fdee6f8a1562',
      'anon:91c07ee9-cbce-47cd-b91b-89b719b464be',
    ]);
  });

  it('drops duplicates, which would otherwise read a store twice and emit every course twice', () => {
    process.env.REINLAB_OWNER_ID = 'reinlab, reinlab,other';
    expect(resolveReinlabOwnerOverrides()).toEqual(['reinlab', 'other']);
  });

  it('ignores empty entries rather than rejecting the whole list', () => {
    process.env.REINLAB_OWNER_ID = 'reinlab,,other,';
    expect(resolveReinlabOwnerOverrides()).toEqual(['reinlab', 'other']);
  });

  it('names the offending entry when one member of the list is malformed', () => {
    process.env.REINLAB_OWNER_ID = 'reinlab,not a valid owner';
    expect(() => resolveReinlabOwnerOverrides()).toThrow(/got "not a valid owner"/);
  });

  it('reports the first entry through the single-id accessor', () => {
    process.env.REINLAB_OWNER_ID = 'first,second';
    expect(resolveReinlabOwnerOverride()).toBe('first');
  });
});

describe('reinlabOwnerSource', () => {
  it('reports override, shared and cookie in that precedence', () => {
    expect(reinlabOwnerSource(null)).toBe('cookie');
    process.env.PERSISTENCE_SHARED_OWNER_ID = 'shared-1';
    expect(reinlabOwnerSource(null)).toBe('shared');
    expect(reinlabOwnerSource('override-1')).toBe('override');
  });
});

// ---------------------------------------------------------------------------
// Course id shape
// ---------------------------------------------------------------------------

describe('isReinlabCourseId', () => {
  const CASES: Array<[string, boolean]> = [
    ['stage-abc_1.2', true],
    ['stage-', true],
    ['', false],
    ['stage id', false],
    ['../stage-1', false],
    ['stage%2F1', false],
    ['course/1', false],
    ['étage-1', false],
  ];

  it.each(CASES)('decides %s', (value, expected) => {
    expect(isReinlabCourseId(value)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Course metadata
// ---------------------------------------------------------------------------

function summary(overrides: Partial<DocumentSummary> & { id: string }): DocumentSummary {
  return {
    name: overrides.id,
    createdAt: 1,
    updatedAt: 1,
    sceneCount: 0,
    ...overrides,
  };
}

describe('toReinlabCourseSummaries', () => {
  it('sorts newest first and drops the fields the contract omits', () => {
    const rows = toReinlabCourseSummaries([
      summary({ id: 'stage-old', updatedAt: 100, createdAt: 10, sceneCount: 2 }),
      summary({
        id: 'stage-new',
        description: 'the newest',
        folderId: 'folder-1',
        updatedAt: 200,
        createdAt: 20,
        sceneCount: 7,
      }),
    ]);

    expect(rows).toEqual([
      {
        id: 'stage-new',
        name: 'stage-new',
        description: 'the newest',
        sceneCount: 7,
        createdAt: 20,
        updatedAt: 200,
        folderId: 'folder-1',
      },
      { id: 'stage-old', name: 'stage-old', sceneCount: 2, createdAt: 10, updatedAt: 100 },
    ]);
    // The store's own fields never ride along, and absent ones are absent
    // rather than null.
    expect(rows[1]).not.toHaveProperty('description');
    expect(rows[1]).not.toHaveProperty('folderId');
    expect(rows[0]).not.toHaveProperty('interactiveMode');
  });

  it('breaks an updatedAt tie on id so the order is stable', () => {
    const rows = toReinlabCourseSummaries([
      summary({ id: 'stage-b', updatedAt: 5 }),
      summary({ id: 'stage-a', updatedAt: 5 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['stage-a', 'stage-b']);
  });
});

// ---------------------------------------------------------------------------
// Media manifest
// ---------------------------------------------------------------------------

describe('buildReinlabMediaManifest', () => {
  it('classifies, de-duplicates and counts every reference of a course', () => {
    expect(buildReinlabMediaManifest(makeCourseDocument())).toEqual([...EXPECTED_MEDIA]);
  });

  it('is an empty array, never null, for a course with no media', () => {
    const empty = { stage: { id: 'stage-empty' }, scenes: [] } as unknown as Parameters<
      typeof buildReinlabMediaManifest
    >[0];
    expect(buildReinlabMediaManifest(empty)).toEqual([]);
  });

  it('emits one entry per kind when one url plays two roles', () => {
    const document = {
      stage: { id: 'stage-1' },
      scenes: [
        {
          id: 'scene-0',
          stageId: 'stage-1',
          title: 'S',
          order: 0,
          type: 'slide',
          content: {
            type: 'slide',
            canvas: {
              id: 'slide-0',
              elements: [
                {
                  id: 'v',
                  type: 'video',
                  src: 'https://cdn.example.com/clip.mp4',
                  poster: 'https://cdn.example.com/clip.mp4',
                },
              ],
            },
          },
        },
      ],
    } as unknown as Parameters<typeof buildReinlabMediaManifest>[0];

    expect(buildReinlabMediaManifest(document)).toEqual([
      { url: 'https://cdn.example.com/clip.mp4', kind: 'video', count: 2 },
      { url: 'https://cdn.example.com/clip.mp4', kind: 'poster', count: 2 },
    ]);
  });

  it('counts a video element that repeats one ref in src and mediaRef once', () => {
    const document = makeCourseDocument();
    const video = buildReinlabMediaManifest(document).find(
      (entry) => entry.url === 'https://cdn.example.com/lecture.mp4',
    );
    expect(video).toEqual({
      url: 'https://cdn.example.com/lecture.mp4',
      kind: 'video',
      count: 1,
    });
  });

  it('orders urls inside one kind by code unit, not by locale', () => {
    const document = {
      stage: { id: 'stage-1' },
      scenes: [
        {
          id: 'scene-0',
          stageId: 'stage-1',
          title: 'S',
          order: 0,
          type: 'slide',
          content: {
            type: 'slide',
            canvas: {
              id: 'slide-0',
              elements: [
                { id: 'a', type: 'image', src: 'https://cdn.example.com/a.png' },
                { id: 'z', type: 'image', src: 'https://cdn.example.com/Z.png' },
              ],
            },
          },
        },
      ],
    } as unknown as Parameters<typeof buildReinlabMediaManifest>[0];

    // 'Z' sorts before 'a' in code-unit order; localeCompare would flip them.
    expect(buildReinlabMediaManifest(document).map((entry) => entry.url)).toEqual([
      'https://cdn.example.com/Z.png',
      'https://cdn.example.com/a.png',
    ]);
  });
});
