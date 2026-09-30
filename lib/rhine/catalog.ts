import type { StageListItem } from '@/lib/utils/stage-storage';
export const ARCHIVE_PAGE_SIZE = 32;
export function displayCourses<T extends StageListItem>(items: T[]): T[] {
  // Empty shells and zero-scene drafts are not presented as completed classrooms.
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || seen.has(item.id) || !Number.isInteger(item.sceneCount) || item.sceneCount < 1) return false;
    seen.add(item.id); return true;
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function archiveCell(index: number) { return { lane: 1, row: (12 + index) % ARCHIVE_PAGE_SIZE }; }
export function classroomQuery(id: string) { return `/reinlab?course=${encodeURIComponent(id)}&from=reinlab`; }
