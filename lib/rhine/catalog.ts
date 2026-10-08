import type { StageListItem } from '@/lib/utils/stage-storage';
export const ARCHIVE_PAGE_SIZE = 32;
export function displayCourses<T extends StageListItem>(items: T[]): T[] {
  // One row per course, newest first.
  //
  // This used to also drop zero-scene rows ("empty shells and zero-scene drafts
  // are not presented as completed classrooms"). It no longer does: the archive
  // and the app's native library read the same library, and a course that the
  // app lists must not be missing here — a course with no scenes yet is a
  // course, and the classroom already says so in its own empty state rather
  // than pretending to be a finished deck. A malformed row is still dropped,
  // because `sceneCount` is what the cover prints.
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || seen.has(item.id) || !Number.isInteger(item.sceneCount)) return false;
    seen.add(item.id); return true;
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function archiveCell(index: number) { return { lane: 1, row: (12 + index) % ARCHIVE_PAGE_SIZE }; }
export function classroomQuery(id: string) { return `/reinlab?course=${encodeURIComponent(id)}&from=reinlab`; }
