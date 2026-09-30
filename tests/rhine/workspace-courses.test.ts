import { describe, expect, it, vi } from 'vitest';
import {
  listOwnerWorkspaceCourses,
  mergeWorkspaceCourses,
} from '@/lib/rhine/workspace-courses';

const course = (id: string, updatedAt: number) => ({
  id, name: id, sceneCount: 2, createdAt: 1, updatedAt,
});

describe('Rhine workspace course index', () => {
  it('shows Agent-owned courses alongside device courses without duplicating ids', () => {
    expect(mergeWorkspaceCourses(
      [course('local', 3), course('shared', 2)],
      [course('server', 4), course('shared', 5)],
    )).toEqual([
      { ...course('shared', 5), source: 'server' },
      { ...course('server', 4), source: 'server' },
      { ...course('local', 3), source: 'device' },
    ]);
  });

  it('does not offer an empty Agent draft as a completed classroom', () => {
    expect(mergeWorkspaceCourses([], [
      { ...course('draft', 7), sceneCount: 0 },
      { ...course('ready', 8), sceneCount: 1 },
    ])).toEqual([{ ...course('ready', 8), sceneCount: 1, source: 'server' }]);
  });

  it('only asks for the owner index when Agent Runtime is enabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ enabled: false }),
    });
    expect(await listOwnerWorkspaceCourses(fetchImpl as typeof fetch)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads the same owner-scoped index as the native archive', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ stages: [course('agent', 6)] }) });
    expect(await listOwnerWorkspaceCourses(fetchImpl as typeof fetch)).toEqual([course('agent', 6)]);
    expect(fetchImpl).toHaveBeenLastCalledWith('/api/stages', { credentials: 'include' });
  });
});
