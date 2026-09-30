/**
 * GET /api/reinlab/whoami — which owner id this request resolves to.
 *
 * WHY it exists: the operator opens this in the Mac's browser, which holds the
 * `anonymous_id` cookie that owns the courses, and copies
 * `effectiveOwnerId` into `REINLAB_OWNER_ID` so the iPad reads that same
 * library. `requestOwnerId` is what this request resolved to, which is what
 * makes the page useful from the browser that has the cookie; once the
 * override is set, `effectiveOwnerId` is the override and `source` says so.
 */
import type { NextRequest } from 'next/server';

import { ownerJson } from '@/lib/server/agent-runtime/route-response';
import { reinlabPreflight, withReinlabRequest } from '@/lib/reinlab/export-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return withReinlabRequest(req, async (context) =>
    ownerJson(
      {
        requestOwnerId: context.requestOwnerId,
        configuredOwnerId: context.configuredOwnerId,
        configuredOwnerIds: context.configuredOwnerIds,
        effectiveOwnerId: context.ownerId,
        effectiveOwnerIds: context.ownerIds,
        source: context.source,
      },
      200,
      context.responseHeaders,
    ),
  );
}

export async function OPTIONS(req: NextRequest) {
  return reinlabPreflight(req);
}
