import type { StageListItem } from '@/lib/utils/stage-storage';

export type WorkspaceCourse = StageListItem & { source: 'device' | 'server' };

/** The Agent index wins when the same id is present in both stores. */
export function mergeWorkspaceCourses(
  device: readonly StageListItem[],
  server: readonly StageListItem[],
): WorkspaceCourse[] {
  const seen = new Set<string>();
  return [
    // A draft shell with no page is not yet a classroom to open.
    ...server.filter(course => course.sceneCount > 0).map(course => ({ ...course, source: 'server' as const })),
    ...device.map(course => ({ ...course, source: 'device' as const })),
  ].filter(course => {
    if (seen.has(course.id)) return false;
    seen.add(course.id);
    return true;
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listOwnerWorkspaceCourses(fetchImpl: typeof fetch = fetch): Promise<StageListItem[]> {
  const runtime = await fetchImpl('/api/agent/runtime').then(response => response.ok ? response.json() : null);
  if (runtime?.enabled !== true) return [];
  const response = await fetchImpl('/api/stages', { credentials: 'include' });
  if (!response.ok) throw new Error(`Owner course index unavailable: ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !Array.isArray((body as { stages?: unknown }).stages)) {
    throw new Error('Owner course index has an invalid shape');
  }
  return (body as { stages: StageListItem[] }).stages;
}
