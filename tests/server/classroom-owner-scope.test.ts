import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OWNER_SCOPE_ENV,
  hasConfiguredOwnerScope,
  parseOwnerScope,
  resolveOwnerScope,
  resolveScopeOwner,
} from '@/lib/server/agent-runtime/classroom-owner-scope';

const A = 'anon:3d4b3da7-d2a4-430e-b880-7ee59826d250';
const B = 'anon:91c07ee9-cbce-47cd-b91b-89b719b464be';
const C = 'anon:57b9051f-5d23-43a8-87d6-60405f68b982';
const COOKIE = 'anon:7d8a8239-a491-46ad-9608-c8756e793579';

describe('parseOwnerScope', () => {
  it('is empty when nothing is configured', () => {
    expect(parseOwnerScope(undefined)).toEqual([]);
    expect(parseOwnerScope('')).toEqual([]);
    expect(parseOwnerScope('   ')).toEqual([]);
  });

  it('reads a comma-separated list and trims it', () => {
    expect(parseOwnerScope(` ${A} , ${B} `)).toEqual([A, B]);
  });

  it('keeps the operator order, which decides where new work lands', () => {
    expect(parseOwnerScope(`${C},${A},${B}`)[0]).toBe(C);
  });

  it('drops duplicates so a partition is never listed twice', () => {
    expect(parseOwnerScope(`${A},${A},${B}`)).toEqual([A, B]);
  });

  it('drops malformed entries instead of refusing to boot', () => {
    // Deliberately more forgiving than REINLAB_OWNER_ID: that variable pins a
    // read surface where reading the wrong library is the failure, this one
    // widens a listing, and refusing to serve the classroom over one bad entry
    // would take the whole app down.
    expect(parseOwnerScope(`${A},anon:not-a-uuid,${B}`)).toEqual([A, B]);
    expect(parseOwnerScope('has space')).toEqual([]);
    expect(parseOwnerScope('')).toEqual([]);
  });

  it('accepts a shared-owner-style plain identifier too', () => {
    expect(parseOwnerScope('reinlab')).toEqual(['reinlab']);
  });
});

describe('resolveOwnerScope', () => {
  it('degenerates to the request owner when nothing is declared', () => {
    expect(resolveOwnerScope(COOKIE, undefined)).toEqual([COOKIE]);
    expect(resolveOwnerScope(COOKIE, '')).toEqual([COOKIE]);
    expect(hasConfiguredOwnerScope(undefined)).toBe(false);
  });

  it('is the declared list when one is', () => {
    expect(resolveOwnerScope(COOKIE, `${A},${B}`)).toEqual([A, B]);
    expect(hasConfiguredOwnerScope(`${A},${B}`)).toBe(true);
  });
});

describe('resolveScopeOwner', () => {
  it('leaves an existing course with its own partition', () => {
    expect(
      resolveScopeOwner({ scope: [A, B], requestOwnerId: COOKIE, stageOwnerId: B }),
    ).toBe(B);
  });

  it('sends new work to the first declared partition', () => {
    expect(resolveScopeOwner({ scope: [A, B], requestOwnerId: COOKIE, stageOwnerId: null })).toBe(A);
  });

  it('refuses to reach a partition outside the declared scope', () => {
    // Naming three partitions must not turn the server into a reader of a
    // fourth: an out-of-scope course falls back to the caller's own owner, which
    // is exactly what a request would have resolved to before this existed.
    expect(
      resolveScopeOwner({ scope: [A, B], requestOwnerId: COOKIE, stageOwnerId: C }),
    ).toBe(COOKIE);
  });

  it('is byte-identical to the old behaviour when nothing is declared', () => {
    const scope = [COOKIE];
    expect(resolveScopeOwner({ scope, requestOwnerId: COOKIE, stageOwnerId: COOKIE })).toBe(COOKIE);
    expect(resolveScopeOwner({ scope, requestOwnerId: COOKIE, stageOwnerId: A })).toBe(COOKIE);
    expect(resolveScopeOwner({ scope, requestOwnerId: COOKIE, stageOwnerId: null })).toBe(COOKIE);
  });
});

/**
 * The policy above only matters if the routes actually consult it. Pin both
 * ends, because a route silently reverting to the raw cookie owner restores the
 * original symptom — the website and the app listing different libraries — with
 * no error anywhere.
 */
describe('owner scope wiring', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('the course index merges the scope', () => {
    const source = read('app/api/stages/route.ts');
    expect(source).toContain('listDocumentsInScope(ownerId)');
    // Creation must not stay on the cookie owner, or work started in a second
    // browser would be invisible to the first.
    expect(source).toContain('creationOwner(ownerId)');
  });

  it('every per-course route resolves the course owner', () => {
    for (const rel of [
      'app/api/stages/[id]/route.ts',
      'app/api/stages/[id]/manifest/route.ts',
      'app/api/stages/[id]/scenes/route.ts',
    ]) {
      const source = read(rel);
      expect(source, rel).toContain('resolveStageRequestOwner({ requestOwnerId: ownerId, stageId: id })');
      expect(source, rel).not.toContain('getOwnerScopedDocumentStore(ownerId)');
    }
  });

  it('the browser document store routes operations by course', () => {
    const source = read('app/api/persistence/[...path]/route.ts');
    expect(source).toContain('resolveStageRequestOwner({ requestOwnerId, stageId: action.stageId })');
    // Authorization and the store must agree on which partition is acting, or a
    // write would be allowed against one owner and performed against another.
    expect(source).toContain('decideDocumentAccess(\n          action,\n          ownerId,');
  });

  it('the environment variable keeps its documented name', () => {
    expect(OWNER_SCOPE_ENV).toBe('PERSISTENCE_OWNER_IDS');
  });
});
