/**
 * GET /api/reinlab/courses/[id] — one course, whole, plus its media manifest.
 *
 * The document and the media list answer together because the client needs
 * both before it can render offline: `course` is the persisted document, and
 * `media` is every reference it holds, which is what the iPad's media cache
 * pre-fetches. The metadata fields come from the listing row so this response
 * agrees with `GET /api/reinlab/courses` for the same course.
 *
 * Every configured owner is searched in order until one holds the document:
 * with a per-browser owner, which partition a course landed in is an accident
 * of which browser created it, and the operator named all of them. Ownership is
 * still enforced by the store — a course under an owner the operator did NOT
 * name answers the identical 404 as a missing one (the no-existence-oracle
 * posture of the agent-runtime routes). The id shape is validated first, before
 * the token gate and before owner resolution, so a malformed URL neither mints
 * an anonymous cookie nor reaches the store.
 */
import type { NextRequest } from 'next/server';

import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import {
  buildReinlabMediaManifest,
  isReinlabCourseId,
  reinlabCorsHeaders,
  reinlabError,
  reinlabPreflight,
  toReinlabCourseDetail,
  withReinlabRequest,
} from '@/lib/reinlab/export-server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isReinlabCourseId(id)) {
    return reinlabError(
      'INVALID_REQUEST',
      400,
      'course id must be non-empty and limited to [A-Za-z0-9._-]',
      reinlabCorsHeaders(req),
    );
  }

  return withReinlabRequest(
    req,
    async ({ ownerIds, responseHeaders }) => {
      for (const ownerId of ownerIds) {
        const store = await getOwnerScopedDocumentStore(ownerId);
        const document = await store.loadDocument(id);
        if (!document) continue;
        const summary = (await store.listDocuments()).find((candidate) => candidate.id === id);
        return ownerJson(
          {
            course: toReinlabCourseDetail(document, summary),
            media: buildReinlabMediaManifest(document),
          },
          200,
          responseHeaders,
        );
      }
      return ownerNotFound(responseHeaders);
    },
    { requiresPersistence: true },
  );
}

export async function OPTIONS(req: NextRequest) {
  return reinlabPreflight(req);
}
