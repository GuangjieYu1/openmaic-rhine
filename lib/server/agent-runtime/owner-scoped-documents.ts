import type {
  DocumentFolderStore,
  DocumentStore,
  DocumentSummary,
  StageFreshnessManifestStore,
} from '@openmaic/storage';

import { readStageMeta } from '@/lib/persistence/stage-meta';
import { resolveOwnerScope, resolveScopeOwner } from './classroom-owner-scope';

import { withPlainJsonDocumentWrites } from '@/lib/document-store/plain-json-store';
import type { AppStage } from '@/lib/document-store/persistence-types';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { createOwnerBoundDocumentStore } from '@/lib/persistence/owner-bound-document-store';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { AppScene } from '@/lib/types/stage';
import type { Queryable } from '@openmaic/storage/document/pg';

/**
 * The owner-bound document store for one HTTP request, plus the
 * trigger-maintained freshness manifest read the PG backend provides.
 */
export type OwnerScopedDocumentStore = DocumentStore<AppScene, AppStage> &
  DocumentFolderStore &
  StageFreshnessManifestStore;

/**
 * The owner-bound document store for one HTTP request.
 *
 * This is the exact seam the agent runner uses (`runner.ts`): the document
 * provider is bound to the resolved owner through the stage access layer.
 * Reads are capability-by-id, writes and listings are owner-only, and every
 * operation re-checks `stage_meta` inside its transaction. A browser holding a
 * course id may therefore read it without gaining mutation authority.
 * `withPlainJsonDocumentWrites` keeps the write
 * boundary identical to the agent tools' (undefined-valued members are never
 * persisted as JSON nulls).
 */
/**
 * Every stage summary this request may see, merged across the declared owner
 * scope.
 *
 * `PERSISTENCE_OWNER_IDS` exists because one person's library can be spread
 * across several `anon:` partitions; without the merge the website archive and
 * the app's native library list different subsets of the same library. First
 * owner wins on an id collision, matching `GET /api/reinlab/courses`.
 */
export async function listDocumentsInScope(requestOwnerId: string): Promise<DocumentSummary[]> {
  const scope = resolveOwnerScope(requestOwnerId);
  if (scope.length === 1 && scope[0] === requestOwnerId) {
    // Nothing declared: skip the merge entirely, so the single-tenant path stays
    // one store call rather than a fan-out of one.
    return (await getOwnerScopedDocumentStore(requestOwnerId)).listDocuments();
  }
  const perOwner = await Promise.all(
    scope.map(async (ownerId) => (await getOwnerScopedDocumentStore(ownerId)).listDocuments()),
  );
  const byId = new Map<string, DocumentSummary>();
  for (const summaries of perOwner) {
    for (const summary of summaries) {
      if (!byId.has(summary.id)) byId.set(summary.id, summary);
    }
  }
  return [...byId.values()];
}

/**
 * The owner this request should act as for one course.
 *
 * `stage_meta` is keyed by stage id alone, so this is one global read rather
 * than a probe of every partition — and it is the same row
 * `decideDocumentAccess` already consults, so routing and authorization agree
 * on who owns the course.
 */
export async function resolveStageRequestOwner(options: {
  readonly requestOwnerId: string;
  readonly stageId: string;
}): Promise<string> {
  const { requestOwnerId, stageId } = options;
  const scope = resolveOwnerScope(requestOwnerId);
  const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  const meta = await readStageMeta(pool, stageId);
  return resolveScopeOwner({
    scope,
    requestOwnerId,
    stageOwnerId: meta?.ownerId ?? null,
  });
}

/** The partition new work lands in under the configured scope. */
export function creationOwner(requestOwnerId: string): string {
  return resolveOwnerScope(requestOwnerId)[0] ?? requestOwnerId;
}

export async function getOwnerScopedDocumentStore(
  ownerId: string,
  mutationFence?: (queryable: Queryable) => Promise<void>,
): Promise<OwnerScopedDocumentStore> {
  const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  return withPlainJsonDocumentWrites(
    createOwnerBoundDocumentStore<AppScene, AppStage>({
      pool,
      ownerId,
      validateScene: validateAppScene,
      validateStage: validateAppStage,
      mutationFence,
    }) as unknown as OwnerScopedDocumentStore,
  );
}
