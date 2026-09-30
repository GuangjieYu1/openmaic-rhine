import type { ClassroomFetchResult } from '@/lib/classroom/load-classroom';

/**
 * The workbench's owner-scoped courses are not the old public-share files
 * served by /api/classroom. Read their document through the owner's own API.
 */
export async function fetchOwnerCourse(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClassroomFetchResult> {
  try {
    const response = await fetchImpl(`/api/stages/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    if (response.status === 404 || response.status === 410) return { outcome: 'absent' };
    if (!response.ok) return { outcome: 'unavailable', status: response.status };
    const document: unknown = await response.json();
    if (!document || typeof document !== 'object') return { outcome: 'unavailable' };
    const candidate = document as { stage?: { id?: unknown }; scenes?: unknown };
    if (candidate.stage?.id !== id || !Array.isArray(candidate.scenes)) {
      return { outcome: 'unavailable' };
    }
    return {
      outcome: 'found',
      classroom: document as Extract<ClassroomFetchResult, { outcome: 'found' }>['classroom'],
    };
  } catch {
    return { outcome: 'unavailable' };
  }
}
