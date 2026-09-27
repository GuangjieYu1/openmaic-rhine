/**
 * The four REINLAB routes end to end, over the shared fake document store.
 *
 * The store is injected at `getOwnerScopedDocumentStore` (the same facade the
 * `/api/stages` route tests use) and the owner seam is mocked, so these tests
 * pin what a client actually receives: the JSON bodies, the status codes, and
 * the CORS grant on every one of them — including the errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createFakeDocumentStore } from '../agent-runtime/_fake-document-store';

const mocks = vi.hoisted(() => ({
  persistenceConfigured: true,
  resolveRequestOwnerId: vi.fn(),
  getStore: vi.fn(),
  fakeStore: null as ReturnType<typeof createFakeDocumentStore> | null,
}));

vi.mock('@/lib/config/feature-flags', () => ({
  isServerPersistenceConfigured: () => mocks.persistenceConfigured,
}));
vi.mock('@/lib/server/agent-runtime/owner', () => ({
  resolveRequestOwnerId: mocks.resolveRequestOwnerId,
}));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: mocks.getStore,
}));

import { GET as getHealth, OPTIONS as optionsHealth } from '@/app/api/reinlab/health/route';
import { GET as getWhoami, OPTIONS as optionsWhoami } from '@/app/api/reinlab/whoami/route';
import { GET as getCourses, OPTIONS as optionsCourses } from '@/app/api/reinlab/courses/route';
import { GET as getCourse, OPTIONS as optionsCourse } from '@/app/api/reinlab/courses/[id]/route';
import {
  COURSE_DESCRIPTION,
  COURSE_NAME,
  COURSE_NOW,
  COURSE_STAGE_ID,
  EXPECTED_MEDIA,
  makeCourseDocument,
} from './_course-fixture';

const ENV_KEYS = [
  'REINLAB_EXPORT_TOKEN',
  'REINLAB_OWNER_ID',
  'PERSISTENCE_SHARED_OWNER_ID',
] as const;
const originalEnv = new Map<string, string | undefined>();

/** The owner the mocked cookie seam resolves for every request. */
const REQUEST_OWNER = 'anon:owner-1';

function apiRequest(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

/** Route params for one course id. */
function courseParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Seed one course into the fake store, overriding what the fixture carries. */
function seedCourse(id: string, name: string, updatedAt: number, description?: string): void {
  const document = makeCourseDocument();
  mocks.fakeStore!.docs.set(id, {
    ...document,
    stage: { ...document.stage, id, name, updatedAt, description },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
  mocks.persistenceConfigured = true;
  mocks.resolveRequestOwnerId.mockReturnValue(REQUEST_OWNER);
  mocks.fakeStore = createFakeDocumentStore();
  mocks.getStore.mockImplementation(async () => mocks.fakeStore!.store);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnv.clear();
});

describe('GET /api/reinlab/health', () => {
  it('reports ok, the contract version and persistence', async () => {
    const response = await getHealth(apiRequest('/api/reinlab/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, apiVersion: 1, persistence: true });
  });

  it('answers without the export token even when one is configured', async () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';

    const response = await getHealth(apiRequest('/api/reinlab/health'));

    expect(response.status).toBe(200);
  });

  it('reports persistence off without resolving an owner or a store', async () => {
    mocks.persistenceConfigured = false;

    const response = await getHealth(apiRequest('/api/reinlab/health'));

    await expect(response.json()).resolves.toMatchObject({ ok: true, persistence: false });
    expect(mocks.resolveRequestOwnerId).not.toHaveBeenCalled();
    expect(mocks.getStore).not.toHaveBeenCalled();
  });

  it('carries the CORS grant and answers the preflight', async () => {
    const origin = 'capacitor://localhost';
    const response = await getHealth(apiRequest('/api/reinlab/health', { origin }));
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('vary')).toBe('Origin');

    const preflight = await optionsHealth(apiRequest('/api/reinlab/health', { origin }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });
});

describe('GET /api/reinlab/whoami', () => {
  it('reports the request owner while no override is set', async () => {
    const response = await getWhoami(apiRequest('/api/reinlab/whoami'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestOwnerId: REQUEST_OWNER,
      configuredOwnerId: null,
      configuredOwnerIds: null,
      effectiveOwnerId: REQUEST_OWNER,
      effectiveOwnerIds: [REQUEST_OWNER],
      source: 'cookie',
    });
  });

  it('reports the override and reads as it', async () => {
    process.env.REINLAB_OWNER_ID = 'pinned-owner';

    const response = await getWhoami(apiRequest('/api/reinlab/whoami'));

    await expect(response.json()).resolves.toEqual({
      requestOwnerId: REQUEST_OWNER,
      configuredOwnerId: 'pinned-owner',
      configuredOwnerIds: ['pinned-owner'],
      effectiveOwnerId: 'pinned-owner',
      effectiveOwnerIds: ['pinned-owner'],
      source: 'override',
    });
  });

  it('reports every configured owner when the library spans partitions', async () => {
    process.env.REINLAB_OWNER_ID =
      'anon:390fedc3-ce3f-445b-b33b-fdee6f8a1562, anon:91c07ee9-cbce-47cd-b91b-89b719b464be';

    const response = await getWhoami(apiRequest('/api/reinlab/whoami'));

    await expect(response.json()).resolves.toEqual({
      requestOwnerId: REQUEST_OWNER,
      configuredOwnerId: 'anon:390fedc3-ce3f-445b-b33b-fdee6f8a1562',
      configuredOwnerIds: [
        'anon:390fedc3-ce3f-445b-b33b-fdee6f8a1562',
        'anon:91c07ee9-cbce-47cd-b91b-89b719b464be',
      ],
      effectiveOwnerId: 'anon:390fedc3-ce3f-445b-b33b-fdee6f8a1562',
      effectiveOwnerIds: [
        'anon:390fedc3-ce3f-445b-b33b-fdee6f8a1562',
        'anon:91c07ee9-cbce-47cd-b91b-89b719b464be',
      ],
      source: 'override',
    });
  });

  it('reports a deployment-wide shared owner as shared', async () => {
    process.env.PERSISTENCE_SHARED_OWNER_ID = 'shared-1';

    const response = await getWhoami(apiRequest('/api/reinlab/whoami'));

    await expect(response.json()).resolves.toMatchObject({ source: 'shared' });
  });

  it('answers 500 naming the variable when the override is malformed', async () => {
    process.env.REINLAB_OWNER_ID = 'not a valid owner';

    const response = await getWhoami(
      apiRequest('/api/reinlab/whoami', { origin: 'http://10.0.0.4' }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toMatch(/REINLAB_OWNER_ID entries must be an anonymous owner id/);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://10.0.0.4');
    // A malformed override must not fall back to reading the request owner.
    expect(mocks.resolveRequestOwnerId).not.toHaveBeenCalled();
  });

  it('requires the token, with CORS on the refusal', async () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';

    const response = await getWhoami(
      apiRequest('/api/reinlab/whoami', { origin: 'capacitor://localhost' }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', message: expect.any(String) },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(mocks.resolveRequestOwnerId).not.toHaveBeenCalled();
  });

  it('answers the preflight without a token', async () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';

    const response = await optionsWhoami(
      apiRequest('/api/reinlab/whoami', { origin: 'capacitor://localhost' }),
    );

    expect(response.status).toBe(204);
  });
});

describe('GET /api/reinlab/courses', () => {
  it('lists the owner courses newest first, with the frozen shape', async () => {
    seedCourse('stage-aaa', 'Day 1', COURSE_NOW);
    seedCourse('stage-bbb', 'Day 2', COURSE_NOW + 100_000, 'the second day');

    const response = await getCourses(apiRequest('/api/reinlab/courses'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      courses: [
        {
          id: 'stage-bbb',
          name: 'Day 2',
          description: 'the second day',
          sceneCount: 2,
          createdAt: COURSE_NOW,
          updatedAt: COURSE_NOW + 100_000,
        },
        {
          id: 'stage-aaa',
          name: 'Day 1',
          sceneCount: 2,
          createdAt: COURSE_NOW,
          updatedAt: COURSE_NOW,
        },
      ],
    });
    expect(mocks.getStore).toHaveBeenCalledWith(REQUEST_OWNER);
  });

  it('reads the pinned owner instead of the request owner when overridden', async () => {
    process.env.REINLAB_OWNER_ID = 'pinned-owner';
    seedCourse('stage-aaa', 'Day 1', COURSE_NOW);

    const response = await getCourses(apiRequest('/api/reinlab/courses'));

    expect(response.status).toBe(200);
    expect(mocks.getStore).toHaveBeenCalledWith('pinned-owner');
  });

  it('answers 404 under CORS when persistence is not configured', async () => {
    mocks.persistenceConfigured = false;

    const response = await getCourses(
      apiRequest('/api/reinlab/courses', { origin: 'http://192.168.1.9' }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://192.168.1.9');
    expect(mocks.getStore).not.toHaveBeenCalled();
    expect(mocks.resolveRequestOwnerId).not.toHaveBeenCalled();
  });

  it('refuses a request with no token, and accepts the query parameter', async () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';
    seedCourse('stage-aaa', 'Day 1', COURSE_NOW);

    const refused = await getCourses(apiRequest('/api/reinlab/courses'));
    expect(refused.status).toBe(401);
    await expect(refused.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
    expect(mocks.getStore).not.toHaveBeenCalled();

    const accepted = await getCourses(apiRequest('/api/reinlab/courses?token=s3cret'));
    expect(accepted.status).toBe(200);
  });

  it('answers the preflight with the LAN origin grant', async () => {
    const origin = 'http://192.168.1.20:5173';

    const response = await optionsCourses(apiRequest('/api/reinlab/courses', { origin }));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-max-age')).toBe('600');
  });
});

describe('GET /api/reinlab/courses/[id]', () => {
  it('returns the course, its list metadata and its media manifest', async () => {
    mocks.fakeStore!.docs.set(COURSE_STAGE_ID, makeCourseDocument());

    const response = await getCourse(
      apiRequest(`/api/reinlab/courses/${COURSE_STAGE_ID}`),
      courseParams(COURSE_STAGE_ID),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.course).toMatchObject({
      id: COURSE_STAGE_ID,
      name: COURSE_NAME,
      description: COURSE_DESCRIPTION,
      createdAt: COURSE_NOW,
      updatedAt: COURSE_NOW,
      sceneCount: 2,
      dslVersion: '1.0.0',
    });
    expect(body.course.stage.id).toBe(COURSE_STAGE_ID);
    expect(body.course.scenes).toHaveLength(2);
    expect(body.course).not.toHaveProperty('folderId');
    expect(body.media).toEqual([...EXPECTED_MEDIA]);
  });

  it('404s a course that is not in this owner scope', async () => {
    const response = await getCourse(
      apiRequest('/api/reinlab/courses/stage-missing'),
      courseParams('stage-missing'),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Not found');
  });

  it('400s a malformed id before any store read or owner resolution', async () => {
    const response = await getCourse(
      apiRequest('/api/reinlab/courses/bad%20id', { origin: 'capacitor://localhost' }),
      courseParams('bad id'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INVALID_REQUEST', message: expect.any(String) },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(mocks.getStore).not.toHaveBeenCalled();
    expect(mocks.resolveRequestOwnerId).not.toHaveBeenCalled();
  });

  it('answers 404 when persistence is not configured', async () => {
    mocks.persistenceConfigured = false;

    const response = await getCourse(
      apiRequest(`/api/reinlab/courses/${COURSE_STAGE_ID}`),
      courseParams(COURSE_STAGE_ID),
    );

    expect(response.status).toBe(404);
    expect(mocks.getStore).not.toHaveBeenCalled();
  });

  it('requires the token', async () => {
    process.env.REINLAB_EXPORT_TOKEN = 's3cret';
    mocks.fakeStore!.docs.set(COURSE_STAGE_ID, makeCourseDocument());

    const refused = await getCourse(
      apiRequest(`/api/reinlab/courses/${COURSE_STAGE_ID}`),
      courseParams(COURSE_STAGE_ID),
    );
    expect(refused.status).toBe(401);
    expect(mocks.getStore).not.toHaveBeenCalled();

    const accepted = await getCourse(
      apiRequest(`/api/reinlab/courses/${COURSE_STAGE_ID}`, { authorization: 'Bearer s3cret' }),
      courseParams(COURSE_STAGE_ID),
    );
    expect(accepted.status).toBe(200);
  });

  it('answers the preflight', async () => {
    const origin = 'ionic://localhost';

    // A preflight carries no params — the route reads none.
    const response = await optionsCourse(
      apiRequest(`/api/reinlab/courses/${COURSE_STAGE_ID}`, { origin }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  });
});
