/**
 * GET /api/reinlab/courses — the course index the iPad renders its library from.
 *
 * Reads go through the owner-bound document store exactly like `/api/stages`:
 * the owners are resolved (or overridden) by the export envelope, never by a
 * request parameter, so this route cannot be pointed at an owner the operator
 * did not name. Only the summary rows are read — no document content is loaded —
 * which is what keeps a library listing cheap on a LAN.
 *
 * A cookie-derived owner is per browser, so one person's library can genuinely
 * be spread across several `anon:` partitions. `REINLAB_OWNER_ID` therefore
 * accepts a comma-separated list and this route merges the partitions, deduping
 * by course id so a course that somehow appears under two owners is still one
 * row. The merge is why the response is sorted here rather than trusting any
 * single store's ordering.
 *
 * The route requires server persistence: a course index is a description of
 * persisted courses, so it gates on `isServerPersistenceConfigured` rather
 * than on the agent runtime (see the note in `lib/config/feature-flags.ts`).
 */
import type { NextRequest } from 'next/server';

import type { DocumentSummary } from '@openmaic/storage';

import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { ownerJson } from '@/lib/server/agent-runtime/route-response';
import {
  reinlabPreflight,
  toReinlabCourseSummaries,
  withReinlabRequest,
} from '@/lib/reinlab/export-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return withReinlabRequest(
    req,
    async ({ ownerIds, responseHeaders }) => {
      const perOwner = await Promise.all(
        ownerIds.map(async (ownerId) => {
          const store = await getOwnerScopedDocumentStore(ownerId);
          return store.listDocuments();
        }),
      );
      const byId = new Map<string, DocumentSummary>();
      for (const summaries of perOwner) {
        for (const summary of summaries) {
          // First owner wins, so the merge cannot produce two rows for one id.
          if (!byId.has(summary.id)) byId.set(summary.id, summary);
        }
      }
      return ownerJson({ courses: toReinlabCourseSummaries([...byId.values()]) }, 200, responseHeaders);
    },
    { requiresPersistence: true },
  );
}

export async function OPTIONS(req: NextRequest) {
  return reinlabPreflight(req);
}
