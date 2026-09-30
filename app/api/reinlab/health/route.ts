/**
 * GET /api/reinlab/health — the iPad's reachability and capability probe.
 *
 * WHY this is the one ungated route: the client calls it before it has decided
 * whether the Mac is online at all, so it cannot require the export token —
 * a probe that needs the credential it is probing for is useless. It also
 * reads no database, so it answers while the store is down, which is the
 * moment the answer matters most: `persistence: false` tells the client that
 * the course routes will refuse even though the process is up.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { REINLAB_API_VERSION, reinlabJson, reinlabPreflight } from '@/lib/reinlab/export-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return reinlabJson(req, {
    ok: true,
    apiVersion: REINLAB_API_VERSION,
    persistence: isServerPersistenceConfigured(),
  });
}

export async function OPTIONS(req: NextRequest) {
  return reinlabPreflight(req);
}
